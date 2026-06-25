import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  TextBlockParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { createHash } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  masterDataTable,
  sourceFilesTable,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
  knowledgeMissedQueriesTable,
  apiUsageLogTable,
} from "@workspace/db";
import { embedQuery } from "./embeddings";
import {
  getDatasetSchema,
  computeMetricStats,
  computeKpis,
  computeTimeseries,
  computeGroupAggregate,
  computeAnimalRanking,
  detectAnomalies,
  type TimeseriesResult,
  type GroupAggregateResult,
  type ComputeBasis,
} from "./compute";
import { CANONICAL_FIELD_MAP } from "./canonical";
import { logger } from "./logger";

const MODEL = "claude-sonnet-4-5";

// ---------------------------------------------------------------------------
// Prompt-cache metrics accumulator (in-memory, per process, resets on restart)
// ---------------------------------------------------------------------------
export interface CacheStats {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  /** Consecutive API calls where cache_read_input_tokens was 0 */
  consecutiveZeroReadStreak: number;
  lastUpdatedAt: string | null;
}

const _cacheStats: CacheStats = {
  totalCalls: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheCreationTokens: 0,
  totalCacheReadTokens: 0,
  consecutiveZeroReadStreak: 0,
  lastUpdatedAt: null,
};

/** Return a snapshot of the current cache stats (shallow copy). */
export function getCacheStats(): CacheStats {
  return { ..._cacheStats };
}

export interface ChartSeries {
  key: string;
  label: string;
}
export interface Chart {
  id: string;
  type: "line" | "bar" | "area" | "pie" | "scatter" | "table";
  title: string;
  description?: string | null;
  xKey?: string | null;
  series: ChartSeries[];
  data: Record<string, unknown>[];
  unit?: string | null;
  basis?: string | null;
}
export interface Citation {
  label: string;
  value: string;
  basis?: string | null;
  sourceType?: "betriebsdaten" | "pdf" | "wissen" | "web" | null;
  shortLabel?: string | null;
}
export interface FarmerQuestion {
  text: string;
  options?: string[];
}

export interface AgentResult {
  text: string;
  charts: Chart[];
  citations: Citation[];
  backQuestions: FarmerQuestion[];
}

export class MissingApiKeyError extends Error {}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new MissingApiKeyError(
      "ANTHROPIC_API_KEY ist nicht konfiguriert. Bitte hinterlegen Sie Ihren Anthropic API-Schlüssel.",
    );
  }
  return new Anthropic({ apiKey });
}

function basisText(b: ComputeBasis): string {
  const range =
    b.dateFrom && b.dateTo ? `, Zeitraum ${b.dateFrom} bis ${b.dateTo}` : "";
  return `Basis: ${b.rowCount} Datensätze${range}`;
}

function chartFromTimeseries(ts: TimeseriesResult, title: string, type: Chart["type"]): Chart {
  return {
    id: `chart_${Math.random().toString(36).slice(2, 10)}`,
    type,
    title,
    xKey: "label",
    series: [{ key: "value", label: ts.label + (ts.unit ? ` (${ts.unit})` : "") }],
    data: ts.points.map((p) => ({ label: p.label, value: p.value, count: p.count })),
    unit: ts.unit ?? null,
    basis: basisText(ts.basis),
  };
}

function chartFromGroup(g: GroupAggregateResult, title: string, type: Chart["type"]): Chart {
  const metricLabel = CANONICAL_FIELD_MAP[g.metric]?.label ?? g.metric;
  const groupLabel = CANONICAL_FIELD_MAP[g.groupBy]?.label ?? g.groupBy;
  return {
    id: `chart_${Math.random().toString(36).slice(2, 10)}`,
    type,
    title,
    description: `${metricLabel} nach ${groupLabel}`,
    xKey: "label",
    series: [{ key: "value", label: metricLabel }],
    data: g.points.map((p) => ({ label: p.label, value: p.value, count: p.count })),
    unit: CANONICAL_FIELD_MAP[g.metric]?.unit ?? null,
    basis: basisText(g.basis),
  };
}

const TOOLS: Tool[] = [
  {
    name: "get_schema",
    description:
      "Liefert die verfügbaren Kennzahlen (Felder), Anzahl Datensätze und den Zeitraum des Datensatzes. Immer zuerst aufrufen, um zu wissen, welche Felder vorhanden sind.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_metric_stats",
    description:
      "Berechnet deterministische Statistiken (Mittelwert, Median, Min, Max, Standardabweichung, Summe, letzter Wert) für eine numerische Kennzahl.",
    input_schema: {
      type: "object",
      properties: { metric: { type: "string", description: "Kanonischer Feldschlüssel, z.B. milk_yield_kg" } },
      required: ["metric"],
    },
  },
  {
    name: "get_kpis",
    description: "Liefert Statistiken für alle vorhandenen numerischen Kennzahlen auf einmal.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_timeseries",
    description:
      "Berechnet einen Zeitverlauf einer Kennzahl, gruppiert nach Tag/Woche/Monat.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string" },
        interval: { type: "string", enum: ["day", "week", "month"] },
        aggregation: { type: "string", enum: ["avg", "sum"] },
      },
      required: ["metric"],
    },
  },
  {
    name: "get_group_aggregate",
    description:
      "Aggregiert eine Kennzahl gruppiert nach einem anderen Feld (z.B. milk_yield_kg nach lactation_number).",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string" },
        groupBy: { type: "string" },
        aggregation: { type: "string", enum: ["avg", "sum", "count"] },
      },
      required: ["metric", "groupBy"],
    },
  },
  {
    name: "get_animal_ranking",
    description: "Rangliste der Tiere nach einer Kennzahl (höchste oder niedrigste Werte).",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string" },
        order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number" },
      },
      required: ["metric"],
    },
  },
  {
    name: "detect_anomalies",
    description:
      "Erkennt Ausreißer einer Kennzahl (Werte außerhalb von Mittelwert ± sigma*Standardabweichung).",
    input_schema: {
      type: "object",
      properties: { metric: { type: "string" }, sigma: { type: "number" } },
      required: ["metric"],
    },
  },
  {
    name: "get_master_data",
    description:
      "Liefert geprüfte Referenz-/Stammdaten des Betreibers (z.B. Zielwerte, Normbereiche), optional nach Kategorie gefiltert.",
    input_schema: {
      type: "object",
      properties: { category: { type: "string" } },
    },
  },
  {
    name: "read_document",
    description:
      "Gibt den extrahierten Volltext aller hochgeladenen PDF-Dokumente zurück. " +
      "Aufrufen, wenn get_schema 0 strukturierte Felder zeigt aber Dokumente vorhanden sind (dokumentAvailable: true). " +
      "Anschließend die Frage direkt aus dem Dokumentinhalt beantworten — keine DB-Werkzeuge nötig.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_knowledge",
    description:
      "Durchsucht die verifizierte Wissensbibliothek semantisch. Aufrufen für allgemeine Fachfragen (Normen, Richtlinien, Beratungsberichte) die nicht aus den Betriebsdaten beantwortet werden können.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Suchanfrage, z.B. 'Zellzahl Grenzwerte' oder 'Eutergesundheit Behandlung'",
        },
        topK: {
          type: "number",
          description: "Anzahl der zurückgegebenen Textstellen (Standard: 5)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_web",
    description:
      "Durchsucht das Internet nach aktuellen Fachinformationen. Aufrufen als Fallback wenn search_knowledge keine relevanten Treffer geliefert hat — z.B. für wirtschaftliche Richtwerte, Grenzwerte, Praxisempfehlungen zu landwirtschaftlichen Kennzahlen.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Suchanfrage auf Deutsch, z.B. 'freiwillige Wartezeit Milchkuh offene Tage wirtschaftlich Kosten'",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "calculate_investment",
    description:
      "Berechnet Wirtschaftlichkeit einer Investition deterministisch: Annuität, Break-even-Jahr, 10-Jahres-Cashflow. Aufrufen wenn alle Parameter vom Nutzer bestätigt wurden.",
    input_schema: {
      type: "object",
      properties: {
        investmentCost: { type: "number", description: "Investitionssumme in €" },
        financingYears: { type: "number", description: "Finanzierungsdauer in Jahren (1–30)" },
        interestRatePct: { type: "number", description: "Zinssatz in Prozent, z.B. 3.5 für 3,5%" },
        annualBenefit: { type: "number", description: "Jährlicher Nettonutzen in € (Einsparungen + Mehrerlös)" },
        subsidy: { type: "number", description: "Förderbetrag in € (optional, default 0)" },
      },
      required: ["investmentCost", "financingYears", "interestRatePct", "annualBenefit"],
    },
  },
  {
    name: "ask_farmer",
    description:
      "Stelle dem Landwirt strukturierte Rückfragen, wenn Parameter fehlen oder unklar sind. Verwende dieses Werkzeug IMMER wenn du Rückfragen stellen möchtest — niemals Fragen als Freitext in der Antwort formulieren. Nach dem Aufruf schreibe einen kurzen einleitenden Satz (ohne Fragezeichen), der erklärt warum du diese Informationen benötigst.",
    input_schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          maxItems: 3,
          description: "MAXIMAL 3 Rückfragen — nur die wirklich entscheidenden. Jede Frage ist ein Objekt mit 'text' und optionalem 'options'.",
          items: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "Die Frage als kurzer, einfacher deutscher Satz (maximal 10 Wörter). Keine Klammern, keine Firmennamen, keine Abkürzungen, keine Beispiele — nur die offene Frage.",
              },
              options: {
                type: "array",
                maxItems: 4,
                items: { type: "string" },
                description: "Optionale Antwort-Chips (2–4 kurze Optionen), z.B. ['Ja', 'Nein', 'Weiß nicht'] oder ['< 5 %', '5–10 %', '> 10 %']. Nur angeben wenn klare Auswahlmöglichkeiten existieren. Bei Fragen die freie Antworten erfordern: weglassen.",
              },
            },
            required: ["text"],
          },
        },
      },
      required: ["questions"],
    },
  },
  {
    name: "emit_chart",
    description:
      "Erstellt ein interaktives Diagramm. Bei strukturierten DB-Daten: source='timeseries'|'group'|'ranking' + metric. Bei PDF-Dokumenten: source='document' + data-Array direkt übergeben.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        chartType: { type: "string", enum: ["line", "bar", "area", "pie"] },
        source: { type: "string", enum: ["timeseries", "group", "ranking", "document"] },
        metric: { type: "string" },
        interval: { type: "string", enum: ["day", "week", "month"] },
        aggregation: { type: "string", enum: ["avg", "sum", "count"] },
        groupBy: { type: "string" },
        order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number" },
        data: {
          type: "array",
          description: "Für source='document': Array von Datenpunkten, z.B. [{name:'Remontierungsrate', wert:28}]",
          items: { type: "object" },
        },
        xKey: { type: "string", description: "Schlüssel für die X-Achse im data-Array, z.B. 'name'" },
        series: {
          type: "array",
          description: "Datenreihen, z.B. [{key:'wert', label:'kg ECM', yAxisId:'left', unit:'kg'}, {key:'zellzahl', label:'Zellzahl', yAxisId:'right', unit:'Tsd./ml'}]. yAxisId 'left'|'right' aktiviert zwei separate Achsen.",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              label: { type: "string" },
              yAxisId: { type: "string", enum: ["left", "right"], description: "Weglassen für Einzelachse; 'right' für zweite Achse" },
              unit: { type: "string", description: "Einheit für Tooltip und Achsenbeschriftung dieser Reihe" },
            },
          },
        },
        unit: { type: "string" },
      },
      required: ["title", "chartType", "source"],
    },
  },
];

const SECTOR_CONTEXT: Record<string, string> = {
  dairy: `BETRIEBSTYP: Milchviehbetrieb
Du analysierst Daten eines Milchviehbetriebs. Moderne Kernkennzahlen: Milchleistung (kg ECM), Zellzahl (SCC, Tsd./ml), Pregnancy Rate / 21-Tage-Trächtigkeitsrate (= Brunsterkennungsrate × Konzeptionsrate / 100), Heat Detection Rate, Remontierung, Laktationsnummer, Abgänge.
Hinweis Fruchtbarkeit: Die Zwischenkalbezeit (ZKZ) gilt heute als veralteter Indikator — sie ist zu träge und nur rückblickend. Moderner Standard ist die Pregnancy Rate, da sie aktives Fruchtbarkeitsmanagement in Echtzeit abbildet.

PROAKTIVE WISSENSSUCHE — typische Suchanfragen nach Berechnungen in diesem Betriebstyp:
- Nach Pregnancy Rate / Fruchtbarkeitsmanagement: "Pregnancy Rate 21-Tage-Trächtigkeitsrate Milchkuh Brunsterkennung Konzeptionsrate wirtschaftlich"
- Nach Zellzahl-Auswertung: "Zellzahlgrenzwert wirtschaftlicher Schaden Eutergesundheit Qualitätsmilch"
- Nach Milchleistung/Laktationskurve: "Persistenz Laktationskurve wirtschaftlich optimale Laktationslänge"
- Nach Remontierungsrate/Abgängen: "Abgangsursachen wirtschaftlich optimale Nutzungsdauer Kuh"
- Nach offenen Tagen / Besamungszeitpunkt: "freiwillige Wartezeit offene Tage Kosten Besamungszeitpunkt wirtschaftlich"`,

  biogas: `BETRIEBSTYP: Biogasanlage
Du analysierst Daten einer Biogasanlage. Relevante Kennzahlen: Gasproduktion (m³/h), Methangehalt (%), Substrat-Input (t/d, FM), organische Trockensubstanz (oTS, %), spezifische Gasausbeute (m³/t oTS), elektrische Leistung (kWel), Betriebsstunden, Wirkungsgrad. Typische Zielwerte: Methangehalt >52%, spezifische Gasausbeute >300 m³/t oTS.

PROAKTIVE WISSENSSUCHE — typische Suchanfragen nach Berechnungen in diesem Betriebstyp:
- Nach spezifischer Gasausbeute/Substrat-Mix: "Substratkosten Gasausbeute wirtschaftlich optimaler Substrateinsatz"
- Nach Methangehalt-Abweichungen: "Methangehalt Spurenelemente Hemmung Biologie Fermenter"
- Nach Betriebsstunden/Wirkungsgrad: "Verstromungswirkungsgrad BHKW Wartungsintervall wirtschaftlich"
- Nach Raumbelastung/HRT: "hydraulische Verweilzeit Raumbelastung Prozessstabilität wirtschaftlich"
- Nach Wärmeeinspeisung/-nutzung: "Wärmenutzung Biogasanlage wirtschaftlich NawaRo-Bonus"`,

  arable: `BETRIEBSTYP: Ackerbaubetrieb
Du analysierst Daten eines Ackerbaubetriebs. Relevante Kennzahlen: Erträge (dt/ha), Fläche (ha), Kulturarten und Fruchtfolge, Bonituren, Niederschlag und Bewässerung, Düngebedarf (kg N/ha), Pflanzenschutzmittelaufwand, Deckungsbeiträge (€/ha). Vergleiche Erträge mit regionalen Durchschnittswerten falls in den Stammdaten vorhanden.

PROAKTIVE WISSENSSUCHE — typische Suchanfragen nach Berechnungen in diesem Betriebstyp:
- Nach Ertragsunterschieden zwischen Kulturen: "Deckungsbeitrag Fruchtfolgeeffekt wirtschaftlich Kulturwahl"
- Nach Düngungsintensität/Stickstoff: "N-Effizienz wirtschaftliche Düngerhöhe Ertragsschwelle Stickstoff"
- Nach Pflanzenschutzaufwand: "Schadensschwelle wirtschaftlich Pflanzenschutz Wirkungskosten"
- Nach Flächenertrag im Jahresvergleich: "Klimarisiko Ertragsschwankung Fruchtfolge Bodengesundheit wirtschaftlich"
- Nach Bewässerungskosten/-mengen: "Bewässerungseffizienz wirtschaftlich Verdunstung Kulturwasserbedarf"`,
};

const SYSTEM_PROMPT_BASE = `Du bist ein vertrauenswürdiger Datenanalyse-Assistent. Du antwortest ausschließlich auf Deutsch in klarer, fachlich korrekter Sprache für Landwirtinnen und Landwirte. Sprich den Nutzer durchgängig mit "du" an — niemals mit "Sie".

ANTWORTLÄNGE UND STIL:
- Beginne direkt mit dem Ergebnis. Niemals mit „Gerne schaue ich mir an…", „Ich habe deine Daten analysiert und…", „Lass mich das für dich berechnen…" oder ähnlichen Einleitungsfloskeln.
- Schreibe keine Zusammenfassung am Ende, wenn die Antwort bereits klar gegliedert ist.
- Einfache Fragen (1 KPI, 1 Zeitraum): max. 3–5 Abschnitte. Meide Füllsätze und Wiederholungen.
- Komplexe Mehrfach-Analysen (explizit mehrere KPIs oder ganzes Betriebsjahr gefragt): dürfen länger sein, aber jeder Abschnitt muss einen eigenen Informationswert haben.

EMOJI-VERBOT IN STRUKTUR:
- Keine Emoji als Nummerierung oder Überschriften-Präfix: kein 1️⃣, 2️⃣, 3️⃣ etc.
- Keine farbigen Status-Kreise: kein 🟢, 🔴, 🟡. Stattdessen Klartext: „im Zielbereich", „kritisch", „liegt unterhalb des Grenzwerts".
- Standard-Markdown für Struktur: ### für Abschnitte, 1. / - für Listen, **fett** für Betonungen.

AKTIONSPLÄNE UND MASSNAHMENTABELLEN:
- Wenn die Antwort eine Liste von Maßnahmen mit mehreren Attributen enthält (z.B. Maßnahme + Effekt + Priorität + Zeitraum), nutze eine Markdown-Tabelle mit entsprechenden Spaltenüberschriften statt einer unstrukturierten Aufzählung.

STRIKTE REGELN:
- Alle Zahlen stammen AUSSCHLIESSLICH aus den Werkzeug-Ergebnissen oder dem extrahierten Dokumenttext. Erfinde NIEMALS Zahlen, Mittelwerte oder Trends.
- Wenn du eine Zahl nennst, muss sie aus einem Werkzeug oder einem Dokumenttext stammen.
- Beginne immer mit get_schema, um zu wissen, welche Felder verfügbar sind.
- KEINE FIRMEN- ODER PRODUKTEMPFEHLUNGEN: Nenne niemals konkrete Markennamen, Herstellernamen oder Produktnamen (z.B. SCR, DeLaval, Lely, GEA, IceQube, Boumatic, Herde, DairyComp oder ähnliche). Beschreibe Technologien und Ansätze stattdessen generisch (z.B. „Halsband-Sensor-System", „Pedometer-System", „automatisches Melksystem", „Herdenmanagement-Software"). Wenn der Nutzer nach konkreten Produkten oder Herstellern fragt, erkläre, dass du keine Produktempfehlungen gibst, und beschreibe stattdessen die relevanten Kriterien und Technologietypen neutral.

QUELLENANGABEN MIT NUMMERN:
- Jedes Mal wenn du eine Zahl oder einen Richtwert aus einem Werkzeug nennst, setze direkt danach eine Fußnoten-Zahl: [1], [2], [3] etc.
- Die Nummer entspricht der Reihenfolge, in der die Quellen im Laufe deiner Antwort erstmals verwendet werden (erste verwendete Quelle = [1], zweite neue Quelle = [2] usw.).
- Werden mehrere Zahlen aus derselben Quelle (d.h. demselben Werkzeugaufruf) zitiert, verwende dieselbe Nummer.
- Beispiel: „Die durchschnittliche Milchleistung beträgt 32,4 kg ECM/Tag [1]. Der Zellzahl-Mittelwert liegt bei 215 Tsd./ml [1]. Laut Wissensbibliothek gilt ein Zellzahl unter 100 Tsd./ml als unauffällig [2]."
- Setze die Marker direkt hinter die Zahl oder den Wert, NICHT am Ende des Satzes, falls der Satz mehrere verschiedene Quellen enthält.
- Verwende NUR diese Nummerierungsform [N] — keine anderen Markierungsformate.
- Wenn ein Wert nicht berechnet werden kann oder Daten fehlen, sage das ehrlich.
- Nutze emit_chart, um zentrale Aussagen mit einem passenden Diagramm zu untermauern (meist 1–3 Diagramme). Bei strukturierten DB-Daten: source='timeseries'|'group'|'ranking'. Bei PDF-Dokumenten: source='document' mit manuell konstruiertem data-Array.
- Vergleiche Werte bei Bedarf mit den geprüften Stammdaten (get_master_data), falls vorhanden.
- Sei präzise und vermeide Spekulation. Lieber weniger, aber belastbare Aussagen.

WENN get_schema 0 FELDER ZEIGT UND dokumentAvailable: true:
- Rufe sofort read_document auf, um den vollständigen extrahierten PDF-Text zu erhalten.
- Beantworte die Frage direkt und vollständig aus dem Dokumentinhalt.
- Kein get_kpis, get_timeseries oder andere DB-Werkzeuge aufrufen — die Daten liegen als Text vor, nicht als Datenbankzeilen.
- Zahlen und Werte aus dem PDF-Text dürfen zitiert werden (sie stammen aus dem Dokument, nicht aus der Datenbank).
- emit_chart DARF und SOLL verwendet werden: Lies die relevanten Kennzahlen aus dem Dokumenttext, baue das data-Array manuell und übergib es mit source='document'.
  Beispiel Balkendiagramm: emit_chart({ title: "Kennzahlen Übersicht", chartType: "bar", source: "document", data: [{ name: "Remontierungsrate", wert: 28 }, { name: "Abgangsrate", wert: 14 }], xKey: "name", series: [{ key: "wert", label: "%", unit: "%" }] })
  Beispiel Doppelachsen-Liniendiagramm (zwei Kennzahlen mit unterschiedlichen Einheiten): emit_chart({ title: "Milchleistung und Zellzahl", chartType: "line", source: "document", data: [{ quartal: "Q2 24", ecm: 40.5, zz: 185 }, { quartal: "Q3 24", ecm: 46.6, zz: 125 }], xKey: "quartal", series: [{ key: "ecm", label: "ECM (kg)", yAxisId: "left", unit: "kg" }, { key: "zz", label: "Zellzahl (Tsd./ml)", yAxisId: "right", unit: "Tsd./ml" }] })
  Verwende chartType:"bar" für Vergleiche, chartType:"pie" für Anteile, chartType:"line" wenn Zeitreihenpunkte vorhanden. Bei zwei Kennzahlen mit unterschiedlichen Skalen immer yAxisId:"left"/"right" verwenden.
- Erstelle nur Grafiken, wenn mindestens 2 Datenpunkte im Dokumenttext vorhanden sind.

WICHTIG — GÜLTIGE DATENQUELLEN:
- Der Abschnitt "HOCHGELADENE DOKUMENTE" im System-Prompt ist eine vollwertige Datenquelle. Zahlen daraus sind genauso belegt wie Zahlen aus einem read_document-Ergebnis.
- Wenn in einem vorherigen Gesprächsschritt Zahlen aus diesem Abschnitt oder aus read_document zitiert wurden, sind diese Zahlen korrekt belegt. Behaupte NIEMALS im Nachhinein, sie seien erfunden oder unbelegt.

WENN IN EINEM FOLGEGESPRÄCH EINE GRAFIK GEWÜNSCHT WIRD UND NUR PDF-DATEN VORHANDEN SIND:
- Extrahiere die relevanten Zahlen direkt aus dem Dokumenttext und rufe emit_chart mit einem manuell konstruierten data-Array auf.
- Stell NICHT in Frage, ob die Zahlen aus der vorherigen Antwort korrekt waren — sie sind korrekt belegt (aus dem Dokument).

RÜCKFRAGEN-VERHALTEN:
- Wenn du Rückfragen an den Landwirt stellen musst, verwende IMMER das Werkzeug ask_farmer({questions:[...]}).
  Formuliere Rückfragen NIEMALS als Freitext in deiner Antwort — nur über das Werkzeug.
- MAXIMAL 3 Rückfragen pro ask_farmer-Aufruf — wähle nur die wirklich entscheidenden Parameter.
- FORMAT: Jedes Fragen-Objekt hat 'text' (kurzer Satz, max. 10 Wörter, kein Emoji, kein Fett, keine Klammern/Firmennamen/Abkürzungen) und optional 'options' (2–4 kurze Antwort-Chips). 'options' nur wenn klare Auswahlmöglichkeiten existieren, z.B. text:"Treten Ketosefälle häufiger auf?", options:["Ja","Nein","Gelegentlich"].
- Bei Investitions-, Wirtschaftlichkeits- oder Planungsfragen: Rufe ZUERST get_schema und get_kpis auf.
  Fasse die relevanten Betriebsdaten kurz zusammen. Rufe dann ask_farmer mit maximal 3 konkreten
  Fragen auf (Investitionssumme, Laufzeit, Zinssatz, erwarteter Jahresnutzen). Rechne erst
  wenn der Nutzer die Parameter bestätigt oder geliefert hat.
- Bei unklaren Fragen (fehlender Zeitraum, fehlende Tier-Angabe, unklare Metrik): Rufe ask_farmer mit
  maximal 2 kurzen Rückfragen auf bevor du analysierst.
- Erfinde NIEMALS Annahmen für fehlende Parameter ohne explizite Bestätigung durch den Nutzer.
- Wenn alle Parameter klar sind: direkt rechnen, keine unnötigen Rückfragen.

WISSENSBIBLIOTHEK — PROAKTIVE NUTZUNG (gilt für ALLE Betriebstypen):
Die Wissensbibliothek enthält Fachliteratur, Beratungsberichte und wissenschaftliche Publikationen des Betriebs. Nutze sie PROAKTIV — unabhängig davon ob es sich um einen Milchvieh-, Schweine-, Geflügel-, Ackerbau-, Gemüsebau-, Weinbau-, Obstbau-, Schaf-, Pferde- oder Biogasbetrieb handelt.

PFLICHTSCHRITT nach jeder Berechnung mit Empfehlungscharakter:
- Sobald du ein statistisches Optimum, einen Bestwert oder eine Rangliste aus den Betriebsdaten berechnest, rufe search_knowledge auf.
- Leite die Suchbegriffe direkt aus der berechneten Kennzahl ab: Kombiniere den Kennzahlennamen mit Begriffen wie "wirtschaftlich", "Kosten", "Praxis", "Optimum", "Empfehlung", "Grenzwert". Beispiel: für "Tageszunahmen Mastschwein" → suche "Tageszunahmen Schwein wirtschaftlich Futterkosten optimale Schlachtreife".
- Ziel: Stelle das statistische Optimum IMMER der wirtschaftlichen Realität gegenüber. Ein Bestwert in den Daten ist nicht automatisch die beste Handlungsempfehlung — es kann wirtschaftliche, praktische oder biologische Gründe geben, warum ein etwas schlechterer Wert besser ist (z.B. frühere Ernte trotz niedrigerer Qualität spart Lagerkosten, frühere Besamung trotz niedrigerer Konzeptionsrate spart offene Tage, geringere Besatzdichte trotz niedrigerer Flächenproduktivität verbessert Tiergesundheit).
- Wenn die Wissensbibliothek wirtschaftliche oder praktische Gegengründe liefert: NENNE SIE EXPLIZIT. Strukturiere deine Antwort klar: (1) Was sagen die Betriebsdaten, (2) Was sagt die Fachliteratur/Forschung, (3) Konkrete Empfehlung unter Berücksichtigung beider Perspektiven.
- Wenn search_knowledge keine relevanten Treffer liefert (leere results oder nur sehr allgemeine Textstellen ohne Bezug zur Frage): rufe als nächstes search_web auf. Formuliere die Suchanfrage auf Deutsch, spezifisch für den Betriebstyp und die berechnete Kennzahl. Beispiel: statt "Konzeptionsrate" besser "freiwillige Wartezeit Milchkuh offene Tage wirtschaftlich Empfehlung".
- Wenn search_web Ergebnisse liefert: nutze die Snippets als Kontextquelle und nenne sie als Quelle in der Antwort.
- Wenn weder search_knowledge noch search_web etwas Relevantes liefern: ignoriere diesen Schritt stillschweigend.

VERTRAUENSGRADE — PFLICHTMARKIERUNG FÜR WISSENSQUELLEN:
Jede inhaltliche Aussage, die nicht aus Betriebsdaten (get_kpis, get_timeseries, get_schema, get_master_data, read_document) stammt, trägt am Ende des Absatzes ein kursives Vertrauens-Label:
- *[Bibliothek]* — der Abschnitt basiert auf search_knowledge-Treffern mit score ≥ 0.55
- *[Web]* — der Abschnitt basiert auf search_web-Ergebnissen
- *[Allgemeinwissen]* — weder Bibliothek noch Web lieferten relevante Treffer; Antwort stammt aus Modell-Trainingswissen
Wichtig: Labels für Betriebsdaten (get_kpis, get_timeseries etc.) werden NICHT gesetzt — dafür gibt es bereits die [N]-Fußnoten. Labels erscheinen als kursiver Zusatz am Ende des jeweiligen Absatzes, z.B.: \`*[Bibliothek]*\`

RÜCKFRAGE BEI UNKLAREN ABKÜRZUNGEN:
Wenn search_knowledge noRelevantResults:true zurückgibt UND die Nutzerfrage einen Begriff enthält, der wie eine Abkürzung aussieht (2–5 aufeinanderfolgende Großbuchstaben, ggf. mit Bindestrichen oder Zahlen, z.B. AAA, RBT, KNS, BHB, MLP, LKV) → rufe IMMER zuerst ask_farmer mit einer einzigen gezielten Rückfrage auf, bevor du mit *[Allgemeinwissen]* antwortest.
Beispiele: AAA → „Meinst du AaA (Anpaarung auf Anpaarung)?", RBT → „Meinst du den Rinderbremsentest (RBT)?", KNS → „Meinst du Koagulase-negative Staphylokokken (KNS)?", BHB → „Meinst du Beta-Hydroxybutyrat (BHB, Ketosemarker)?"
Formuliere die Rückfrage als ask_farmer-Werkzeugaufruf — niemals als Freitext.

KRITISCHE KENNZAHLEN-SCHLEIFE — MODERNE vs. VERALTETE KPIs:
Nach jeder Analyse einer Fruchtbarkeits- oder Managementkennzahl prüfe aktiv, ob die verwendete Kennzahl dem aktuellen Stand der Fachwelt entspricht — oder ob es eine modernere, aussagekräftigere Alternative gibt. Weise den Nutzer darauf hin, wenn eine Kennzahl:
- nur Vergangenheit abbildet, ohne direkte Steuerungsmöglichkeit zu bieten
- durch eine modernere Kennzahl ersetzt wurde, die mehr Managementrelevanz hat
- zwar berechnet werden kann, aber in der modernen Beratung als veraltet gilt

Vorgehen: Führe zunächst die angeforderte Analyse durch. Füge danach — klar abgetrennt unter einer Überschrift wie „### Fachlicher Hinweis: Kennzahl kritisch betrachtet" — einen kurzen Abschnitt ein, der erklärt ob und warum eine modernere Alternative sinnvoller wäre. Schlage dann an, die modernere Kennzahl ebenfalls zu berechnen, falls die Daten es erlauben.

Bekannte Beispiele veralteter KPIs und ihre modernen Alternativen (Milchvieh):
- ZKZ (Zwischenkalbezeit): Veraltete Kennzahl — sie bildet nur die Vergangenheit ab und ist zu träge für aktives Fruchtbarkeitsmanagement. Moderner Standard: **Pregnancy Rate** (21-Tage-Trächtigkeitsrate = Brunsterkennungsrate × Konzeptionsrate / 100). Die Pregnancy Rate zeigt in Echtzeit, wie effektiv das Fruchtbarkeitsmanagement läuft, und erlaubt gezielte Eingriffe.
- Erstbesamungserfolg (EB%) allein: Zu einseitig — berücksichtigt weder Brunsterkennung noch Besamungszeitpunkt systematisch. Moderner: Pregnancy Rate und Heat Detection Rate getrennt betrachten.
- Zwischentragezeit: Ähnlich wie ZKZ — rückblickend und träge. Pregnancy Rate ist reaktionsfähiger.

Bekannte Beispiele (andere Betriebstypen):
- Biogasanlage: Nur Gasvolumen ohne spezifische Gasausbeute (m³/t oTS) zu berichten ist unvollständig — Substratqualität geht verloren.
- Ackerbau: Rohertrag (dt/ha) ohne Deckungsbeitrag (€/ha) sagt wenig über Wirtschaftlichkeit aus.

Dieser Grundsatz gilt für alle Betriebstypen. Wenn du unsicher bist, rufe search_knowledge oder search_web auf, um den aktuellen Beratungsstand zu prüfen, bevor du eine Kennzahl als modern oder veraltet einordnest.

ERGÄNZUNGEN ZUM BESTEHENDEN REGELWERK (Patch-Block — ändert keine bestehende Regel)

SCHEMA-CACHING (Patch A — Absichtserklärung; Enforcement erfordert Code-Änderung)
- get_schema nur erneut aufrufen bei: (a) erster Aufruf der Session,
  (b) anderer Betrieb/Datensatz referenziert, (c) >5 Turns seit letztem Aufruf.

FALLBACK OHNE DATENQUELLE (Patch B)
- Wenn get_schema 0 Felder UND dokumentAvailable: false:
  keine DB-/Dokument-Tools nutzen, Datenlücke transparent benennen,
  search_web als einzige Quelle mit Kennzeichnung *[Web]*.

TRANSPARENZ BEI PARTIELLER DATENGRUNDLAGE (Patch K)
- Wenn dokumentAvailable: false UND fields.length > 0: Antwort enthält
  verbindlich einen kurzen Abschnitt "Hinweis zur Datengrundlage" —
  Analyse basiert nur auf Betriebsdaten + Wissensbibliothek, kein
  eigenes Dokument vorhanden, Upload-Vorschlag. Nicht optional/heuristisch.

KOMPLEXITÄTS-HEURISTIK (Patch C)
- Einfache Frage = 1 Kennzahl/1 Maßnahme, keine Tabelle nötig → max. 5 Abschnitte.
- Komplexe Analyse = ≥2 Variablen im Vergleich, Zeitreihe, oder
  Investitionsentscheidung → darf über 5 Abschnitte gehen, aber jeder
  Abschnitt braucht eigenen Informationswert.

TRENNUNG DER ZITIERSYSTEME (Patch D, revidiert)
- [n] gilt für jeden quantitativen Wert aus jedem Tool — inklusive
  search_knowledge und search_web (alle Tool-Quellen werden nummeriert).
- *[Bibliothek]*/*[Web]*/*[Allgemeinwissen]* markiert die gesamte
  Einschätzung/Empfehlung am Satz- oder Absatzende, nicht einzelne Zahlen.
- Trennlinie: Quelle-für-Zahl ([n]) vs. Vertrauen-für-Aussage (kursiver Tag).

KONFLIKTDARSTELLUNG DATEN VS. BIBLIOTHEK (Patch E)
- Bei Abweichung zwischen statistischem Bestwert und Bibliotheksempfehlung:
  beide Werte explizit nennen, 1–2 Sätze Begründung, klare Empfehlung
  mit Quellen-Tag.

ESKALATIONSTRIGGER (Patch F, präzisiert durch Patch M)
1. WERKZEUGKONFLIKT: Wenn basis.rowCount bei beiden Tools identisch ist
   UND Abweichung > 10 % — keinen der Werte als "richtig" ausgeben,
   Konflikt benennen, Betreiber informieren.
   Wenn rowCount unterschiedlich ist: kein Trigger, aber Pflicht, den
   unterschiedlichen Datenumfang als wahrscheinliche (nicht bestätigte)
   Ursache zu nennen.
2. INVESTITIONSSCHWELLE: calculate_investment-Ergebnis (effectiveCost) >
   10.000 € UND kein search_knowledge-Treffer ≥ 0,55. Trigger prüft das
   Berechnungsergebnis, nicht die vom Nutzer genannte Zahl.
3. MARKENWIEDERHOLUNG: Nutzer verlangt trotz Erklärung erneut Marken-/
   Produktempfehlung — einmalig kurze Begründung, dann Thema nicht weiter
   führen.
4. SICHERHEITSRELEVANTE FRAGE OHNE QUELLEN: Tierwohl, Düngeverordnung,
   Gülleverordnung — weder Bibliotheks- noch Web-Treffer → keine Antwort
   aus *[Allgemeinwissen]*, Betreiber informieren, Fachberatung empfehlen.

EPISTEMISCHE VORSICHT BEI ERKLÄRUNGEN (Patch N)
- Erklärungen für Diskrepanzen zwischen Werkzeug-Ergebnissen dürfen nur
  Mechanismen benennen, die aus den zurückgegebenen Tool-Daten ableitbar
  sind (z. B. basis.rowCount). Nicht sichtbare Filterlogik nicht als
  Tatsache behaupten — als Vermutung kennzeichnen:
  "möglicherweise", "ich kann das nicht bestätigen".`;

interface RunOptions {
  datasetId: string;
  conversation: { role: "user" | "assistant"; content: string }[];
  sector?: string;
  systemExtra?: string;
  /** Clerk user ID of the customer running this analysis — used for knowledge-gap logging. */
  userId?: string;
  onProgress?: (step: string | null) => Promise<void>;
  /** Called with each text token as Claude generates the answer. */
  onTextDelta?: (delta: string) => void;
  /** Called once per search_knowledge call with the unique document titles found. */
  onSourceSearched?: (sources: string[]) => void;
  /** Called immediately when a chart is emitted by the agent (before done). */
  onChart?: (chart: Chart) => void;
}

async function fetchDocumentContext(datasetId: string): Promise<string> {
  const docs = await db
    .select({ name: sourceFilesTable.name, previewRows: sourceFilesTable.previewRows })
    .from(sourceFilesTable)
    .where(
      and(
        eq(sourceFilesTable.datasetId, datasetId),
        eq(sourceFilesTable.kind, "document"),
        eq(sourceFilesTable.status, "ready"),
      ),
    );
  const parts = docs
    .map((doc) => {
      const rows = (doc.previewRows ?? []) as { text?: string }[];
      const text = rows[0]?.text?.trim() ?? "";
      if (!text) return null;
      return `--- Dokument: ${doc.name} ---\n${text}`;
    })
    .filter((p): p is string => p !== null);
  if (parts.length === 0) return "";
  return (
    `\n\nHOCHGELADENE DOKUMENTE (Berichte, PDFs):\n` +
    `Die folgenden Dokument-Inhalte stehen für Fragen zur Verfügung. ` +
    `Nutze diese Inhalte, wenn keine strukturierten Datenzeilen vorhanden sind.\n\n` +
    parts.join("\n\n")
  );
}

/** Retry any async fn on transient Anthropic 500s (flaky upstream). */
async function callWithRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if ((status === 500 || status === 529) && attempt < maxAttempts) {
        const delay = 1000 * attempt;
        logger.warn({ attempt, delay, status }, "Anthropic transient error — Wiederhole...");
        await new Promise((r) => setTimeout(r, delay));
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function runAgent(opts: RunOptions): Promise<AgentResult> {
  const client = getClient();
  const charts: Chart[] = [];
  const citations: Citation[] = [];
  const { datasetId } = opts;

  const messages: MessageParam[] = opts.conversation.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const docContext = await fetchDocumentContext(datasetId);

  // Check if any ready knowledge docs exist
  const [knowledgeCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(knowledgeDocumentsTable)
    .where(sql`status = 'ready'`);
  const knowledgeDocsExist = (knowledgeCount?.c ?? 0) > 0;

  // Build knowledge doc title list for systemExtra
  let knowledgeTitles = "";
  if (knowledgeDocsExist) {
    const knowledgeDocs = await db
      .select({
        title: knowledgeDocumentsTable.title,
        chunkCount: knowledgeDocumentsTable.chunkCount,
      })
      .from(knowledgeDocumentsTable)
      .where(sql`${knowledgeDocumentsTable.status} = 'ready'`);
    const titleList = knowledgeDocs
      .map((d) => `- "${d.title}" (${d.chunkCount ?? "?"} Chunks)`)
      .join("\n");
    knowledgeTitles =
      `\n\nWISSENSBIBLIOTHEK (verified): Nutze search_knowledge(query) für Fachinformationen. Verfügbare Dokumente:\n${titleList}`;
  }

  const sectorCtx = SECTOR_CONTEXT[opts.sector ?? "dairy"] ?? SECTOR_CONTEXT.dairy;
  const SYSTEM_PROMPT = `${sectorCtx}\n\n${SYSTEM_PROMPT_BASE}`;

  function buildSystemBlocks(
    docCtx: string,
    extra?: string,
  ): TextBlockParam[] {
    const blocks: TextBlockParam[] = [];

    blocks.push({
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    });

    if (docCtx) {
      blocks.push({
        type: "text",
        text: docCtx,
        cache_control: { type: "ephemeral" },
      });
    }

    const dynamic = (extra ?? "") || undefined;
    if (dynamic) {
      blocks.push({ type: "text", text: dynamic });
    }

    return blocks;
  }

  async function execTool(block: ToolUseBlock): Promise<unknown> {
    const input = (block.input ?? {}) as Record<string, unknown>;
    const metric = input.metric as string | undefined;
    switch (block.name) {
      case "get_schema": {
        const schema = await getDatasetSchema(datasetId);
        const dokumentAvailable = docContext.length > 0 || knowledgeDocsExist;
        return dokumentAvailable
          ? { ...schema, dokumentAvailable: true }
          : schema;
      }
      case "get_kpis":
        return computeKpis(datasetId);
      case "get_metric_stats": {
        const stats = await computeMetricStats(datasetId, metric!);
        if (stats) {
          citations.push({
            label: stats.label,
            value: `Ø ${stats.mean}${stats.unit ? " " + stats.unit : ""}`,
            basis: basisText(stats.basis),
            sourceType: "betriebsdaten",
          });
        }
        return stats ?? { error: "Keine Daten für diese Kennzahl" };
      }
      case "get_timeseries": {
        const tsInterval = (input.interval as "day" | "week" | "month") ?? "month";
        const tsAgg = (input.aggregation as "avg" | "sum") ?? "avg";
        const tsKey = `ts:${metric}:${tsInterval}:${tsAgg}`;
        const cachedTs = (turnResultCache.get(tsKey) as Awaited<ReturnType<typeof computeTimeseries>> | undefined);
        const tsResult = cachedTs !== undefined
          ? cachedTs
          : await computeTimeseries(datasetId, metric!, tsInterval, tsAgg);
        if (cachedTs === undefined) turnResultCache.set(tsKey, tsResult);
        return tsResult ?? { error: "Keine Daten" };
      }
      case "get_group_aggregate": {
        const gaAgg = (input.aggregation as "avg" | "sum" | "count") ?? "avg";
        const gaKey = `ga:${metric}:${input.groupBy as string}:${gaAgg}`;
        const cachedGa = (turnResultCache.get(gaKey) as Awaited<ReturnType<typeof computeGroupAggregate>> | undefined);
        const gaResult = cachedGa !== undefined
          ? cachedGa
          : await computeGroupAggregate(datasetId, metric!, input.groupBy as string, gaAgg);
        if (cachedGa === undefined) turnResultCache.set(gaKey, gaResult);
        return gaResult ?? { error: "Keine Daten" };
      }
      case "get_animal_ranking":
        return (
          (await computeAnimalRanking(
            datasetId,
            metric!,
            (input.order as "asc" | "desc") ?? "desc",
            (input.limit as number) ?? 10,
          )) ?? { error: "Keine Daten" }
        );
      case "detect_anomalies": {
        // Return only aggregated summary — per-animal/date/value rows must
        // never be sent to the LLM provider (data-residency constraint).
        const result = await detectAnomalies(datasetId, metric!, (input.sigma as number) ?? 2);
        if (!result) return { error: "Zu wenige Daten" };
        return {
          metric: result.metric,
          label: result.label,
          unit: result.unit ?? null,
          mean: result.mean,
          std: result.std,
          lowerBound: result.lowerBound,
          upperBound: result.upperBound,
          outlierCount: result.outlierCount,
          basisRowCount: result.basis.rowCount,
          // Deliberately omitting result.outliers (per-animal rows) —
          // data-residency constraint: only aggregates may be sent to AI.
        };
      }
      case "get_master_data": {
        const cat = input.category as string | undefined;
        const sector = opts.sector ?? "dairy";
        // Filter master data to rows matching this dataset's sector or universal rows (sector IS NULL)
        const sectorFilter = or(
          isNull(masterDataTable.sector),
          eq(masterDataTable.sector, sector),
        );
        const rows = cat
          ? await db
              .select()
              .from(masterDataTable)
              .where(and(eq(masterDataTable.category, cat), sectorFilter))
          : await db.select().from(masterDataTable).where(sectorFilter);
        return rows;
      }
      case "read_document": {
        if (!docContext) return { text: "Keine Dokumente vorhanden." };
        // Strip the header prefix — return only the raw document text
        const rawText = docContext
          .replace(/^\n\nHOCHGELADENE DOKUMENTE.*?:\n/s, "")
          .trim();
        // Push citations for each document (unique by name), use category as topic label
        const seenDocNames = new Set<string>();
        const docTitles: string[] = [];
        const docNameMatches = rawText.matchAll(/^--- Dokument: (.+?) ---$/gm);
        for (const m of docNameMatches) {
          const name = m[1].trim();
          if (!seenDocNames.has(name)) {
            seenDocNames.add(name);
            docTitles.push(name);
          }
        }
        if (docTitles.length > 0) {
          const catRows = await db.execute(
            sql`SELECT title, category FROM knowledge_documents WHERE title = ANY(${docTitles}) AND status = 'ready'`,
          );
          const catMap = new Map<string, string | null>(
            (catRows.rows as { title: string; category: string | null }[]).map((r) => [r.title, r.category]),
          );
          const seenTopics = new Set<string>();
          for (const title of docTitles) {
            const topic = catMap.get(title)?.trim() || "Hochgeladenes Dokument";
            if (!seenTopics.has(topic)) {
              seenTopics.add(topic);
              citations.push({
                label: topic,
                value: "PDF-Dokument",
                basis: null,
                sourceType: "pdf",
              });
            }
          }
        }
        return { text: rawText };
      }
      case "calculate_investment": {
        const investmentCost = input.investmentCost as number;
        const financingYears = Math.max(1, Math.min(30, input.financingYears as number));
        const interestRatePct = input.interestRatePct as number;
        const annualBenefit = input.annualBenefit as number;
        const subsidy = (input.subsidy as number | undefined) ?? 0;

        const effectiveCost = investmentCost - subsidy;
        const i = interestRatePct / 100;

        let annuity: number;
        if (i === 0) {
          annuity = effectiveCost / financingYears;
        } else {
          annuity =
            (effectiveCost * i * Math.pow(1 + i, financingYears)) /
            (Math.pow(1 + i, financingYears) - 1);
        }

        annuity = Math.round(annuity * 100) / 100;

        const cashflowTable: {
          jahr: number;
          annualBenefit: number;
          annuity: number;
          netEffect: number;
          cumulative: number;
        }[] = [];

        let cumulative = 0;
        let breakEvenYear: number | null = null;

        for (let year = 1; year <= 10; year++) {
          const netEffect = Math.round((annualBenefit - annuity) * 100) / 100;
          cumulative = Math.round((cumulative + netEffect) * 100) / 100;
          cashflowTable.push({
            jahr: year,
            annualBenefit: Math.round(annualBenefit * 100) / 100,
            annuity: Math.round(annuity * 100) / 100,
            netEffect,
            cumulative,
          });
          if (breakEvenYear === null && cumulative > 0) {
            breakEvenYear = year;
          }
        }

        let rating: "wirtschaftlich" | "grenzwertig" | "nicht empfohlen";
        if (breakEvenYear !== null && breakEvenYear <= financingYears) {
          rating = "wirtschaftlich";
        } else if (breakEvenYear !== null && breakEvenYear <= financingYears * 1.3) {
          rating = "grenzwertig";
        } else {
          rating = "nicht empfohlen";
        }

        return {
          annuity,
          breakEvenYear,
          rating,
          effectiveCost,
          cashflowTable,
          summary: {
            investmentCost,
            subsidy,
            effectiveCost,
            financingYears,
            interestRatePct,
            annualBenefit,
          },
        };
      }
      case "search_knowledge": {
        const query = input.query as string;
        const topK = Math.min((input.topK as number | undefined) ?? 5, 10);
        const SIMILARITY_THRESHOLD = 0.55;
        try {
          const queryVec = await embedQuery(query);
          const vecStr = `[${queryVec.join(",")}]`;
          const rows = await db.execute(
            sql`
              SELECT kc.chunk_text, kd.title, kd.category,
                     (1 - (kc.embedding <=> ${vecStr}::vector)) AS similarity
              FROM knowledge_chunks kc
              JOIN knowledge_documents kd ON kd.id = kc.doc_id
              WHERE kd.status = 'ready'
              ORDER BY kc.embedding <=> ${vecStr}::vector
              LIMIT ${topK}
            `,
          );
          const allRows = rows.rows as { chunk_text: string; title: string; category: string | null; similarity: number }[];
          const relevantRows = allRows.filter((r) => Number(r.similarity) >= SIMILARITY_THRESHOLD);
          if (relevantRows.length === 0) {
            const topScore = allRows[0] ? Number(allRows[0].similarity).toFixed(3) : null;
            logger.debug({ query, topScore: topScore ?? "n/a" }, "search_knowledge: keine relevanten Treffer über Schwellenwert");
            db.insert(knowledgeMissedQueriesTable).values({
              query,
              topScore: topScore ?? null,
              customerId: opts.userId ?? null,
            }).catch((err) => logger.warn({ err }, "Fehler beim Speichern der missed query"));
            return { results: [], noRelevantResults: true };
          }
          const results = relevantRows.map(
            (r) => ({ title: r.title, text: r.chunk_text, similarity: Number(r.similarity) }),
          );
          // Push one citation per unique document title found in relevant results
          // Use category as label (topic) instead of filename
          const seenTitles = new Set<string>();
          const seenTopics = new Set<string>();
          for (const r of relevantRows) {
            if (!seenTitles.has(r.title)) {
              seenTitles.add(r.title);
              const topic = r.category?.trim() || "Wissensquelle";
              if (!seenTopics.has(topic)) {
                seenTopics.add(topic);
                citations.push({
                  label: topic,
                  value: "Wissensbibliothek",
                  basis: null,
                  sourceType: "wissen",
                });
              }
            }
          }
          // Notify SSE listener which documents were found
          if (seenTitles.size > 0) {
            opts.onSourceSearched?.(Array.from(seenTitles));
          }
          return { results };
        } catch (err) {
          logger.error({ err }, "search_knowledge fehlgeschlagen");
          return { error: "Suche fehlgeschlagen" };
        }
      }
      case "search_web": {
        const query = input.query as string;
        const apiKey = process.env.BRAVE_SEARCH_API_KEY;
        if (!apiKey) {
          return { error: "Keine Web-Suche konfiguriert (BRAVE_SEARCH_API_KEY fehlt)" };
        }

        // --- Cache check ---
        const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
        const queryHash = createHash("sha256").update(normalizedQuery).digest("hex");

        try {
          const cached = await db.execute(
            sql`SELECT results FROM web_search_cache WHERE query_hash = ${queryHash} AND expires_at > NOW() LIMIT 1`
          );
          if (cached.rows.length > 0) {
            const results = (cached.rows[0] as { results: { title: string; url: string; snippet: string }[] }).results;
            logger.debug({ queryHash }, "search_web: Cache-Hit");
            if (results.length > 0) {
              citations.push({ label: `Web: ${query}`, value: results[0].url, basis: null, sourceType: "web" });
            }
            return { results, query, cached: true };
          }
        } catch (err) {
          logger.warn({ err }, "search_web: Cache-Lookup fehlgeschlagen, fahre mit Live-Suche fort");
        }

        // --- Live search (Brave) ---
        try {
          const url = new URL("https://api.search.brave.com/res/v1/web/search");
          url.searchParams.set("q", query);
          url.searchParams.set("count", "5");
          url.searchParams.set("country", "de");
          url.searchParams.set("search_lang", "de");
          url.searchParams.set("text_decorations", "false");
          const res = await fetch(url.toString(), {
            headers: {
              "Accept": "application/json",
              "Accept-Encoding": "gzip",
              "X-Subscription-Token": apiKey,
            },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            return { error: `Web-Suche fehlgeschlagen: HTTP ${res.status}` };
          }
          const data = await res.json() as {
            web?: { results?: { title: string; url: string; description?: string }[] };
          };
          const results = (data.web?.results ?? []).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.description ?? "",
          }));

          // --- Store in cache ---
          if (results.length > 0) {
            try {
              await db.execute(
                sql`INSERT INTO web_search_cache (query_hash, query, results)
                    VALUES (${queryHash}, ${normalizedQuery}, ${JSON.stringify(results)}::jsonb)
                    ON CONFLICT (query_hash) DO UPDATE
                      SET results = EXCLUDED.results,
                          created_at = NOW(),
                          expires_at = NOW() + INTERVAL '7 days'`
              );
            } catch (err) {
              logger.warn({ err }, "search_web: Cache-Speichern fehlgeschlagen");
            }
            citations.push({ label: `Web: ${query}`, value: results[0].url, basis: null, sourceType: "web" });
          }

          return { results, query, cached: false };
        } catch (err) {
          logger.error({ err }, "search_web fehlgeschlagen");
          return { error: "Web-Suche fehlgeschlagen" };
        }
      }
      case "ask_farmer": {
        const qs = (input.questions as Array<{text?: string; options?: string[]} | string> | undefined) ?? [];
        for (const q of qs) {
          if (typeof q === "string") {
            if (q.trim()) backQuestions.push({ text: q.trim() });
          } else if (q && typeof q.text === "string" && q.text.trim()) {
            backQuestions.push({
              text: q.text.trim(),
              options: Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string" && Boolean(o)) : undefined,
            });
          }
        }
        return { acknowledged: true, questionCount: qs.length };
      }
      case "emit_chart": {
        const title = (input.title as string) ?? "Diagramm";
        const chartType = (input.chartType as Chart["type"]) ?? "bar";
        const source = input.source as string;
        if (source === "timeseries") {
          const emitTsInterval = (input.interval as "day" | "week" | "month") ?? "month";
          const emitTsAgg = (input.aggregation as "avg" | "sum") ?? "avg";
          const emitTsKey = `ts:${metric}:${emitTsInterval}:${emitTsAgg}`;
          const cachedTs = turnResultCache.get(emitTsKey) as TimeseriesResult | null | undefined;
          const ts = cachedTs !== undefined
            ? cachedTs
            : await computeTimeseries(datasetId, metric!, emitTsInterval, emitTsAgg);
          if (cachedTs === undefined) turnResultCache.set(emitTsKey, ts);
          if (!ts) return { error: "Keine Daten für Diagramm" };
          const chart = chartFromTimeseries(ts, title, chartType);
          charts.push(chart);
          opts.onChart?.(chart);
          return { ok: true, points: ts.points.length, basis: basisText(ts.basis) };
        }
        if (source === "group") {
          const emitGaAgg = (input.aggregation as "avg" | "sum" | "count") ?? "avg";
          const emitGaKey = `ga:${metric}:${input.groupBy as string}:${emitGaAgg}`;
          const cachedGa = turnResultCache.get(emitGaKey) as GroupAggregateResult | null | undefined;
          const g = cachedGa !== undefined
            ? cachedGa
            : await computeGroupAggregate(datasetId, metric!, input.groupBy as string, emitGaAgg);
          if (cachedGa === undefined) turnResultCache.set(emitGaKey, g);
          if (!g) return { error: "Keine Daten für Diagramm" };
          const chart = chartFromGroup(g, title, chartType);
          charts.push(chart);
          opts.onChart?.(chart);
          return { ok: true, points: g.points.length, basis: basisText(g.basis) };
        }
        if (source === "ranking") {
          const r = await computeAnimalRanking(
            datasetId,
            metric!,
            (input.order as "asc" | "desc") ?? "desc",
            (input.limit as number) ?? 10,
          );
          if (!r) return { error: "Keine Daten für Diagramm" };
          const metricLabel = CANONICAL_FIELD_MAP[r.metric]?.label ?? r.metric;
          const rankingChart: Chart = {
            id: `chart_${Math.random().toString(36).slice(2, 10)}`,
            type: chartType,
            title,
            xKey: "label",
            series: [{ key: "value", label: metricLabel }],
            data: r.entries.map((e) => ({
              label: e.animalId,
              value: e.value,
              count: e.count,
            })),
            unit: CANONICAL_FIELD_MAP[r.metric]?.unit ?? null,
            basis: basisText(r.basis),
          };
          charts.push(rankingChart);
          opts.onChart?.(rankingChart);
          return { ok: true, points: r.entries.length, basis: basisText(r.basis) };
        }
        // source === "document": agent passes pre-built data from PDF text
        if (source === "document") {
          const rawData = input.data as Record<string, unknown>[] | undefined;
          if (!rawData || rawData.length < 2) {
            return { error: "Zu wenige Datenpunkte für ein Diagramm (mind. 2 benötigt)" };
          }
          const xKey = (input.xKey as string) ?? "name";
          const seriesInput = (input.series as { key: string; label: string }[] | undefined) ?? [];
          if (seriesInput.length === 0) {
            return { error: "Keine series-Definition angegeben" };
          }
          const docChart: Chart = {
            id: `chart_${Math.random().toString(36).slice(2, 10)}`,
            type: chartType,
            title,
            xKey,
            series: seriesInput,
            data: rawData,
            unit: (input.unit as string) ?? null,
            basis: "Dokument",
          };
          charts.push(docChart);
          opts.onChart?.(docChart);
          return { ok: true, points: rawData.length, basis: "Dokument" };
        }
        return { error: "Unbekannte Diagrammquelle" };
      }
      default:
        return { error: `Unbekanntes Werkzeug: ${block.name}` };
    }
  }

  function progressLabel(toolName: string, input: Record<string, unknown>): string {
    const metric = (input.metric as string | undefined) ?? "";
    switch (toolName) {
      case "get_schema": return "Lese Datenschema";
      case "get_kpis": return "Berechne alle Kennzahlen";
      case "get_metric_stats": return `Berechne Statistik${metric ? ` für ${metric}` : ""}`;
      case "get_timeseries": return `Berechne Zeitreihe${metric ? ` für ${metric}` : ""}`;
      case "get_group_aggregate": return `Aggregiere${metric ? ` ${metric}` : ""} nach Gruppe`;
      case "get_animal_ranking": return `Erstelle Rangliste${metric ? ` für ${metric}` : ""}`;
      case "detect_anomalies": return `Erkenne Ausreißer${metric ? ` bei ${metric}` : ""}`;
      case "get_master_data": return "Lade Stammdaten";
      case "read_document": return "Lese Dokumententext";
      case "search_knowledge": return "Durchsuche Wissensdatenbank";
      case "search_web": return "Durchsuche das Internet";
      case "calculate_investment": return "Berechne Investitionswirtschaftlichkeit";
      case "emit_chart": return `Erstelle Diagramm`;
      case "ask_farmer": return "Formuliere Rückfragen";
      default: return "Verarbeite Daten";
    }
  }

  // Per-invocation cache: avoids redundant DB queries when emit_chart reuses
  // the same metric/groupBy/interval that was already fetched in the same turn.
  const turnResultCache = new Map<string, unknown>();

  let finalText = "";
  let toolWasCalled = false;
  let firstTextDeltaFired = false;
  const backQuestions: FarmerQuestion[] = [];
  const maxTurns = 20;

  // Grounding: tools that prove real data was accessed
  const groundedTools = new Set([
    "get_schema",
    "get_metric_stats", "get_kpis", "get_timeseries",
    "get_group_aggregate", "get_animal_ranking", "detect_anomalies",
    "read_document",
    "search_knowledge",
    "calculate_investment",
    "ask_farmer",
  ]);

  for (let turn = 0; turn < maxTurns; turn++) {
    // Use streaming so text tokens reach the client in real-time via onTextDelta.
    // callWithRetry wraps finalMessage(); 500/529 errors from Anthropic occur
    // before the first token arrives, so retries never emit duplicate deltas.
    const response = await callWithRetry(async () => {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 8192,
        system: buildSystemBlocks(
          docContext,
          ((opts.systemExtra ?? "") + knowledgeTitles) || undefined,
        ),
        tools: TOOLS,
        tool_choice: { type: "auto" as const },
        messages,
      });
      if (opts.onTextDelta) {
        stream.on("text", (delta) => {
          if (!firstTextDeltaFired) {
            firstTextDeltaFired = true;
            opts.onProgress?.("Generiere Antwort…");
          }
          opts.onTextDelta!(delta);
        });
      }
      return stream.finalMessage();
    });
    const usage = response.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    const cacheCreation = usage.cache_creation_input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;

    // Update in-memory accumulator
    _cacheStats.totalCalls += 1;
    _cacheStats.totalInputTokens += usage.input_tokens;
    _cacheStats.totalOutputTokens += usage.output_tokens;
    _cacheStats.totalCacheCreationTokens += cacheCreation;
    _cacheStats.totalCacheReadTokens += cacheRead;
    _cacheStats.lastUpdatedAt = new Date().toISOString();
    if (cacheRead > 0) {
      _cacheStats.consecutiveZeroReadStreak = 0;
    } else {
      _cacheStats.consecutiveZeroReadStreak += 1;
    }

    // Persist usage row to DB so history survives server restarts (fire-and-forget)
    db.insert(apiUsageLogTable).values({
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens: cacheRead,
    }).catch((err: unknown) => {
      logger.warn({ err }, "api_usage_log insert failed");
    });

    logger.debug({
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: cacheCreation,
      cache_read_input_tokens: cacheRead,
      cache_hit: cacheRead > 0,
    }, "Anthropic usage");

    // Alert when cache reads are absent across multiple consecutive calls —
    // this indicates cache_control blocks are not being written or TTL expired.
    if (_cacheStats.consecutiveZeroReadStreak >= 3) {
      logger.warn({
        consecutiveZeroReadStreak: _cacheStats.consecutiveZeroReadStreak,
        totalCalls: _cacheStats.totalCalls,
        totalCacheCreationTokens: _cacheStats.totalCacheCreationTokens,
      }, "Prompt-Cache-Warnung: cache_read_input_tokens war in mehreren aufeinanderfolgenden Aufrufen 0 — Cache-Treffer fehlen möglicherweise");
    }

    const textParts = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text);
    if (textParts.length) finalText = textParts.join("\n").trim();

    if (response.stop_reason === "tool_use") {
      const toolUses = response.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use",
      );
      // emit_chart is valid when:
      // - follow-up turn (numbers already grounded in prior turn), OR
      // - document context is available (agent reads PDF numbers and builds chart manually)
      const isFollowUp = opts.conversation.length > 0;
      const hasDocContext = docContext.length > 0 || knowledgeDocsExist;
      if (toolUses.some((t) => groundedTools.has(t.name) || ((isFollowUp || hasDocContext) && t.name === "emit_chart"))) {
        toolWasCalled = true;
      }
      messages.push({ role: "assistant", content: response.content });
      const toolResults = [];
      for (const tu of toolUses) {
        const label = progressLabel(tu.name, (tu.input ?? {}) as Record<string, unknown>);
        await opts.onProgress?.(label);
        let result: unknown;
        try {
          result = await execTool(tu);
        } catch (err) {
          logger.error({ err, tool: tu.name }, "Werkzeugausführung fehlgeschlagen");
          result = { error: "Berechnung fehlgeschlagen" };
        }
        toolResults.push({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }
    break;
  }

  // Grounding enforcement: if the model returned text without calling any
  // compute tool, replace the response with a safe fallback. This prevents
  // hallucinated numbers from reaching the user.
  if (!toolWasCalled && finalText && opts.conversation.length === 1) {
    logger.warn(
      { datasetId: opts.datasetId },
      "Agent antwortete ohne Werkzeugaufruf — Antwort wird verworfen (Grounding-Garantie)",
    );
    finalText =
      "Die Analyse konnte nicht auf Basis Ihrer Daten durchgeführt werden. " +
      "Bitte stellen Sie sicher, dass der Datensatz korrekt hochgeladen und verarbeitet wurde.";
    return { text: finalText, charts, citations, backQuestions };
  }

  return { text: finalText, charts, citations, backQuestions };
}

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  TextBlockParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  pool,
  masterDataTable,
  sourceFilesTable,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
  knowledgeMissedQueriesTable,
  apiUsageLogTable,
  semenPlanningTable,
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

// ---------------------------------------------------------------------------
// Central model routing — the ONLY place in the codebase with model strings.
// All other files must import getModelForTask() and never hardcode a model.
// Verified 2026-07-01: claude-haiku-4-5-20251001, claude-sonnet-4-6, claude-opus-4-6 ✓
// ---------------------------------------------------------------------------

export type ModelTaskType =
  | "newsletter_generation"
  | "insights_summary"
  | "doc_categorization"
  | "follow_up_generation"
  | "benchmark_extraction"
  | "chat_analysis_simple"
  | "chat_analysis"
  | "chat_analysis_deep";

export function getModelForTask(taskType: ModelTaskType): string {
  switch (taskType) {
    case "newsletter_generation":
    case "insights_summary":
    case "doc_categorization":
    case "follow_up_generation":
    case "benchmark_extraction":
      return "claude-haiku-4-5-20251001";
    case "chat_analysis_simple":
    case "chat_analysis":
      return "claude-sonnet-4-6";
    case "chat_analysis_deep":
      return "claude-opus-4-6";
  }
}

// ---------------------------------------------------------------------------
// Pricing constants — Anthropic published prices (2025-07), per 1M tokens (USD).
// Used by the operator monitoring page to estimate cost; never shown to customers.
// ---------------------------------------------------------------------------
export const MODEL_PRICING_USD_PER_1M: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
  "claude-sonnet-4-6":         { input: 3.00, output: 15.00 },
  "claude-opus-4-6":           { input: 15.00, output: 75.00 },
};

// Fixed EUR/USD conversion rate for approximate cost display.
export const EUR_PER_USD = 0.92;

export type PricingSource = "env" | "db" | "hardcoded";

/**
 * Returns the effective model pricing and its source.
 * Priority: OPERATOR_MODEL_PRICING env var → master_data DB row → hardcoded defaults.
 *
 * The env var format is a JSON object keyed by model name:
 *   OPERATOR_MODEL_PRICING='{"claude-sonnet-4-6":{"input":3,"output":15}}'
 * Partial overrides are merged on top of the hardcoded defaults.
 *
 * The DB row uses master_data with category='system_config', key='model_pricing_json',
 * value= same JSON string format as the env var.
 */
export async function getEffectiveModelPricing(): Promise<{
  pricing: Record<string, { input: number; output: number }>;
  source: PricingSource;
}> {
  const envValue = process.env["OPERATOR_MODEL_PRICING"];
  if (envValue) {
    try {
      const parsed = JSON.parse(envValue) as Record<string, { input: number; output: number }>;
      return {
        pricing: { ...MODEL_PRICING_USD_PER_1M, ...parsed },
        source: "env",
      };
    } catch {
      logger.warn("OPERATOR_MODEL_PRICING env var is not valid JSON — falling through to DB/hardcoded");
    }
  }

  try {
    const { masterDataTable } = await import("@workspace/db");
    const { and, eq } = await import("drizzle-orm");
    const rows = await db
      .select({ value: masterDataTable.value })
      .from(masterDataTable)
      .where(and(eq(masterDataTable.category, "system_config"), eq(masterDataTable.key, "model_pricing_json")))
      .limit(1);
    if (rows.length > 0 && rows[0]?.value) {
      const parsed = JSON.parse(rows[0].value) as Record<string, { input: number; output: number }>;
      return {
        pricing: { ...MODEL_PRICING_USD_PER_1M, ...parsed },
        source: "db",
      };
    }
  } catch {
    // DB unavailable or row malformed — continue to hardcoded fallback
  }

  return { pricing: MODEL_PRICING_USD_PER_1M, source: "hardcoded" };
}

export function estimateCostEur(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricingOverride?: Record<string, { input: number; output: number }>,
): number {
  const table = pricingOverride ?? MODEL_PRICING_USD_PER_1M;
  const pricing = table[model];
  if (!pricing) return 0;
  const usd =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;
  return Math.round(usd * EUR_PER_USD * 10000) / 10000;
}

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
  type: "line" | "bar" | "area" | "pie" | "scatter" | "table" | "kpi";
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

export interface BetaToolEntry {
  toolName: string;
  keyParams: Record<string, unknown>;
  durationMs: number;
  escalationTrigger?: string | null;
  escalationReason?: string | null;
}

export interface WidgetSpec {
  type: "heat_abatement" | "fresh_cow";
  prefill: Record<string, number>;
}

export interface AgentResult {
  text: string;
  charts: Chart[];
  citations: Citation[];
  backQuestions: FarmerQuestion[];
  widgetSpec: WidgetSpec | null;
  toolLog: BetaToolEntry[];
  escalationTrigger: { type: string; reason: string } | null;
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
    name: "search_dairycomp_manual",
    description:
      "Durchsucht das DairyComp-Handbuch semantisch. NUR aufrufen wenn der Nutzer eine Frage zur Bedienung, Konfiguration oder Funktionen der DairyComp-Software stellt. Nicht für allgemeine Betriebsanalysen oder Milchleistungsfragen verwenden.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Suchanfrage zur DairyComp-Software, z.B. 'Wie stelle ich den Laktationsindex ein?' oder 'FRESH-Events auswerten'",
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
    name: "search_farm_abbreviations",
    description:
      "Durchsucht die betriebsspezifische DairyComp-Abkürzungsliste (ALTER3-Makros). Aufrufen wenn der Nutzer ein unbekanntes DairyComp-Kürzel nennt oder fragt was ein Befehl macht — BEVOR ask_farmer aufgerufen wird. Erkennung: 2–8 aufeinanderfolgende Großbuchstaben, ggf. mit Bindestrich oder Zahl (z.B. BREDSUM, BRDCLG, CLOSEUP, ARAS1).",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Das Kürzel oder der Befehlsname, z.B. 'CLOSEUP', 'BREDSUM', 'COWSUM'",
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
    name: "get_event_stats",
    description:
      "Berechnet Aggregatstatistiken für Kuh-Events aus importierten Herdenmanagementsystem-Daten. " +
      "Aufrufen für Fragen zu Besamungen, Abkalbungen, Trockenstellungen, Abgängen, Lahmheit o.ä. " +
      "Nur verwenden wenn get_schema events-Daten zeigt.\n\n" +
      "BEISPIELE FÜR HÄUFIGE ANWENDUNGSFÄLLE:\n" +
      "- Bullenvergleich (Konzeptionsrate je Bulle): event_type='BRED', group_by='remark'\n" +
      "  → Jede Zeile enthält den Bullennamen (remark-Feld), Gesamtbesamungen, Trächtigkeiten (PREG) und Konzeptionsrate\n" +
      "  → Für Erstbesamungserfolg: Besamungen mit remark-Wert gefiltert auf Tiere mit genau 1 BRED-Event\n" +
      "- Technikervergleich (Erfolgsrate je Besamungstechniker): event_type='BRED', group_by='technician'\n" +
      "  → Jede Zeile enthält den Technikernamen, Besamungszahl und Konzeptionsrate\n" +
      "- Lahmheitstrend je Monat: event_type='LAME', group_by='month'\n" +
      "- Abgänge nach Ursache: event_type=['SOLD','DIED'], group_by='result'",
    input_schema: {
      type: "object",
      properties: {
        event_type: {
          description: "Einzelner Event-Typ (z.B. 'BRED') oder Array (z.B. ['SOLD','DIED']). Gängige Typen: BRED=Besamung, FRESH=Abkalbung, DRY=Trockenstellen, LAME=Lahmheit, SOLD=Abgang Verkauf, DIED=Verendung, PREG=TU positiv, OPEN=Offen, ABORT=Abort",
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        date_from: { type: "string", description: "ISO-Datum YYYY-MM-DD (optional)" },
        date_to: { type: "string", description: "ISO-Datum YYYY-MM-DD (optional)" },
        group_by: {
          type: "string",
          enum: ["month", "quarter", "year", "remark", "result", "technician"],
          description: "Gruppierung: month/quarter/year = zeitlich; remark = Bullname/Diagnose (Freitext aus dem HMS); result = Ergebnis-Code; technician = Besamungstechniker",
        },
      },
      required: ["event_type"],
    },
  },
  {
    name: "get_repro_kpis",
    description:
      "Berechnet Fruchtbarkeits- und Herdenkennzahlen direkt in SQL aus den Event-Daten. " +
      "Berechnet: Konzeptionsrate, Erstbesamungskonzeptionsrate, Besamungsindex, 21-Tage-Trächtigkeitsrate (approximiert), Abgangsrate, Abortrate. " +
      "Nur verwenden wenn get_schema events-Daten zeigt.",
    input_schema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "ISO-Datum YYYY-MM-DD (optional)" },
        date_to: { type: "string", description: "ISO-Datum YYYY-MM-DD (optional)" },
      },
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
      "Erstellt ein interaktives Diagramm. Bei strukturierten DB-Daten: source='timeseries'|'group'|'ranking' + metric. Bei PDF-Dokumenten: source='document' + data-Array direkt übergeben. Bei Investitionsantworten: chartType='kpi' mit genau 3 Einträgen { label, value, unit } im data-Array (Gesamtinvestition, Kosten/Kuh/Jahr, Break-even Jahre); source='document'.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        chartType: { type: "string", enum: ["line", "bar", "area", "pie", "kpi"] },
        source: { type: "string", enum: ["timeseries", "group", "ranking", "document"] },
        metric: { type: "string" },
        interval: { type: "string", enum: ["day", "week", "month"] },
        aggregation: { type: "string", enum: ["avg", "sum", "count"] },
        groupBy: { type: "string" },
        order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number" },
        data: {
          type: "array",
          description: "Für source='document': Array von Datenpunkten, z.B. [{name:'Remontierungsrate', wert:28}]. Für chartType='kpi': genau 3 Objekte mit den Pflichtfeldern { label: string, value: number|string, unit: string }, z.B. [{label:'Gesamtinvestition',value:120000,unit:'€'},{label:'Kosten/Kuh/Jahr',value:240,unit:'€'},{label:'Break-even',value:7,unit:'Jahre'}]",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: {},
              unit: { type: "string" },
            },
          },
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
  {
    name: "run_sql",
    description:
      "Führt eine benutzerdefinierte PostgreSQL SELECT-Abfrage gegen die Datensatztabellen aus. " +
      "Verwende dieses Werkzeug wenn die spezialisierten Werkzeuge nicht ausreichen — z.B. für:\n" +
      "- Zeitabstand zwischen Events desselben Tieres (z.B. Tage zwischen FRESH und BRED)\n" +
      "- Tiere mit bestimmten Ereignismustern (z.B. 3+ Besamungen ohne PREG)\n" +
      "- Individuelle Tierdaten, Trendanalysen über mehrere Event-Typen gleichzeitig\n" +
      "- Felder in data_rows, die get_schema als Spalten auflistet\n" +
      "- Jede Frage, die flexible SQL-Logik erfordert\n\n" +
      "TABELLEN (dataset_id IMMER als WHERE-Filter angeben):\n" +
      "cow_events: dataset_id, animal_id TEXT, event_date DATE, event_type TEXT, " +
      "dim INTEGER (Laktationstag), remark TEXT, result VARCHAR(4), technician TEXT\n" +
      "data_rows: dataset_id, file_id UUID, record_date DATE, data JSONB\n" +
      "  → JSONB-Zugriff: data->>'Spaltenname' (Text), (data->>'Zahl')::numeric\n\n" +
      "REGELN: Nur SELECT/WITH erlaubt. Max. 500 Zeilen. Bei großen Tabellen LIMIT oder Aggregation verwenden.\n" +
      "Die aktuelle dataset_id steht im Systemkontext als CURRENT_DATASET_ID.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Valide PostgreSQL SELECT- oder WITH-Abfrage. Kein INSERT/UPDATE/DELETE/DROP/TRUNCATE. " +
            "Immer WHERE dataset_id = '<CURRENT_DATASET_ID>' einbauen.",
        },
        description: {
          type: "string",
          description: "Kurze Beschreibung was diese Abfrage analysiert (1 Satz, für Fortschrittsanzeige)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "show_heat_abatement_calculator",
    description: "Zeigt dem Landwirt einen interaktiven Hitzestress-Kühl-Investitionsrechner. Aufrufen wenn der Nutzer fragt, ob sich Kühlung, Ventilatoren oder Verdunstungskühlung lohnt, oder nach Hitzestress-Kosten fragt. Nicht für allgemeine Hitze-Tipps ohne Investitionsbezug.",
    input_schema: {
      type: "object",
      properties: {
        herdSize: { type: "number", description: "Anzahl laktierende Kühe (aus Dataset-Kontext vorausfüllen wenn bekannt)" },
        heatStressDays: { type: "number", description: "Hitzestresstage/Jahr (Deutschland-Default: 45)" },
        milkLossPerDayKg: { type: "number", description: "Milchverlust/Kuh/Hitzestresstag in kg (Default: 1.5)" },
        milkPriceEuroKg: { type: "number", description: "Milchpreis €/kg (Default: 0.40)" },
        investmentCost: { type: "number", description: "Investitionskosten Kühlsystem € (Default: 50000)" },
        annualOperatingCost: { type: "number", description: "Betriebskosten/Jahr € (Default: 3000)" },
        systemLifetimeYears: { type: "number", description: "Nutzungsdauer Jahre (Default: 15)" },
        interestRatePct: { type: "number", description: "Zinssatz % (Default: 3.5)" },
      },
    },
  },
  {
    name: "show_fresh_cow_calculator",
    description: "Zeigt dem Landwirt einen interaktiven Frischmelker-Programm-ROI-Rechner. Aufrufen wenn der Nutzer fragt ob sich ein intensiveres Frischmelker-/Transitphasen-Programm lohnt, nach Metritis/Ketose/Hypokalzämie-Kosten fragt, oder die Wirtschaftlichkeit der Transitphase berechnen möchte.",
    input_schema: {
      type: "object",
      properties: {
        calvingsPerYear: { type: "number", description: "Abkalbungen/Jahr (aus Dataset-Kontext)" },
        metritisRatePct: { type: "number", description: "Metritis-Inzidenz % (Default: 25)" },
        ketosisRatePct: { type: "number", description: "Ketose-Inzidenz % (Default: 20)" },
        hypocalcemiaRatePct: { type: "number", description: "Hypokalzämie-Inzidenz % (Default: 30)" },
        metrisisCostEuro: { type: "number", description: "Kosten je Metritis-Fall € (Default: 400)" },
        ketosisCostEuro: { type: "number", description: "Kosten je Ketose-Fall € (Default: 300)" },
        hypocalcemiaCostEuro: { type: "number", description: "Kosten je Hypokalzämie-Fall € (Default: 150)" },
        diseaseReductionPct: { type: "number", description: "Krankheitsreduktion mit verbessertem Programm % (Default: 35)" },
        programCostPerCowEuro: { type: "number", description: "Mehrkosten Programm je abgekalbter Kuh € (Default: 25)" },
      },
    },
  },
  {
    name: "get_semen_planning",
    description: "Lädt die gespeicherte Besamungs- und Sperma-Kostenplanung für diesen Betrieb. Aufrufen wenn der Nutzer Fragen zur Besamungsplanung, Spermakosten, Sperma-Kategorien oder Kälbererlösen stellt — um zu prüfen ob bereits Parameter gespeichert sind.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "calculate_semen_planning",
    description: "Berechnet und speichert die Besamungs- und Sperma-Kostenplanung für den Betrieb: Jahresbedarf Portionen, Kosten je Sperma-Kategorie, Kälbererlöse, Nettokosten, Färsenbalance und Aufzuchtplatzbedarf. Aufrufen wenn alle Parameter vom Nutzer bestätigt wurden. Das Ergebnis wird persistent pro Betrieb gespeichert.",
    input_schema: {
      type: "object",
      properties: {
        summeKuehe: { type: "number", description: "Anzahl Kühe im Betrieb" },
        konzRateKuehe: { type: "number", description: "Konzeptionsrate Kühe in % (1–100)" },
        konzRateFaersen: { type: "number", description: "Konzeptionsrate Färsen in % (1–100)" },
        prozentAbgaenge: { type: "number", description: "Abgangsrate Kühe in % (1–100)" },
        eka: { type: "number", description: "Erstkalbealter in Monaten (z.B. 26)" },
        verlusteKueheRate: { type: "number", description: "Verlustrate Kühe in % (Verendungen etc.)" },
        verlusteRinderRate: { type: "number", description: "Verlustrate Rinder/Nachzucht in %" },
        anteilHoGesext: { type: "number", description: "Anteil HO gesext Sperma in % (muss zusammen mit den anderen Anteilen 100 ergeben)" },
        anteilHoKonv: { type: "number", description: "Anteil HO konventionell Sperma in %" },
        anteilBeefGesext: { type: "number", description: "Anteil Beef gesext Sperma in %" },
        anteilBeefKonv: { type: "number", description: "Anteil Beef konventionell Sperma in %" },
        preisHoGesext: { type: "number", description: "Preis je Portion HO gesext in €" },
        preisHoKonv: { type: "number", description: "Preis je Portion HO konventionell in €" },
        preisBeefGesext: { type: "number", description: "Preis je Portion Beef gesext in €" },
        preisBeefKonv: { type: "number", description: "Preis je Portion Beef konventionell in €" },
        verkaufspreisHoBullkalb: { type: "number", description: "Verkaufspreis HO Bullenkalb (♂) in € (28 Tage)" },
        verkaufspreisBeefWeiblich: { type: "number", description: "Verkaufspreis weibliches Beef-Kalb in € (28 Tage)" },
        verkaufspreisBeefBullkalb: { type: "number", description: "Verkaufspreis Beef Bullenkalb (♂) in € (28 Tage)" },
      },
      required: [
        "summeKuehe", "konzRateKuehe", "konzRateFaersen", "prozentAbgaenge",
        "eka", "verlusteKueheRate", "verlusteRinderRate",
        "anteilHoGesext", "anteilHoKonv", "anteilBeefGesext", "anteilBeefKonv",
        "preisHoGesext", "preisHoKonv", "preisBeefGesext", "preisBeefKonv",
        "verkaufspreisHoBullkalb", "verkaufspreisBeefWeiblich", "verkaufspreisBeefBullkalb",
      ],
    },
  },
  {
    name: "signal_escalation",
    description: "Rufe dieses Tool genau EINMAL auf, wenn einer der vier definierten Eskalationstrigger ausgelöst wird — BEVOR du die Antwort formulierst. Das Tool hat keine Auswirkung auf die Antwort, protokolliert aber den Trigger strukturiert für den Betreiber.",
    input_schema: {
      type: "object" as const,
      properties: {
        trigger_type: {
          type: "string",
          enum: ["Werkzeugkonflikt", "Investitionsschwelle", "Markenwiederholung", "Sicherheitsrelevante Frage"],
          description: "Typ des ausgelösten Eskalationstriggers",
        },
        reason: {
          type: "string",
          description: "Kurze Begründung (max. 200 Zeichen) warum dieser Trigger ausgelöst wurde",
        },
      },
      required: ["trigger_type", "reason"],
    },
  },
];

/** Reduced toolset for simple single-KPI questions — no ask_farmer, no investment calc, no chart. */
function getToolsForTask(taskType: ModelTaskType): Tool[] {
  if (taskType === "chat_analysis_simple") {
    const exclude = new Set(["ask_farmer", "calculate_investment", "calculate_semen_planning", "emit_chart"]);
    return TOOLS.filter((t) => !exclude.has(t.name));
  }
  return TOOLS;
}

const SECTOR_CONTEXT: Record<string, string> = {
  dairy: `BETRIEBSTYP: Milchviehbetrieb
Du analysierst Daten eines Milchviehbetriebs. Moderne Kernkennzahlen: Milchleistung (kg ECM), Zellzahl (SCC, Tsd./ml), Pregnancy Rate / 21-Tage-Trächtigkeitsrate (= Brunsterkennungsrate × Konzeptionsrate / 100), Heat Detection Rate, Remontierung, Laktationsnummer, Abgänge.
Hinweis Fruchtbarkeit: Die Zwischenkalbezeit (ZKZ) gilt heute als veralteter Indikator — sie ist zu träge und nur rückblickend. Moderner Standard ist die Pregnancy Rate, da sie aktives Fruchtbarkeitsmanagement in Echtzeit abbildet.

EVENT-DATEN (Herdenmanagementsystem-Import):
Wenn get_schema ein "events"-Objekt zurückgibt (z.B. { total: 51772, types: [...], dateRange: {...}, animals: 6913 }), sind Kuh-Event-Daten aus einem Herdenmanagementsystem vorhanden.

WERKZEUGWAHL BEI EVENT-DATEN:
- Event-basierte Fruchtbarkeitskennzahlen (Konzeptionsrate, Besamungsindex, Abgangsrate, Abortrate) → get_repro_kpis
- Zählung/Trend eines bestimmten Event-Typs (z.B. wie viele Lahmheiten pro Monat?) → get_event_stats(event_type, group_by)
- Bullenvergleich nach Konzeptionsrate → get_event_stats(event_type='BRED', group_by='remark')
- Produktionskennzahlen (Milch, SCC, Fett) → get_kpis / get_timeseries (aus den strukturierten data_rows)
- Komplexe/individuelle Abfragen (Tiere mit Mustern, Zeitabstände, Mehrfach-Joins) → run_sql mit eigenem SQL

EVENT-TYP-SCHLÜSSEL (systemübergreifend gültig):
BRED=Besamung | FRESH=Abkalbung | DRY=Trockenstellen | LAME=Lahmheit
SOLD=Abgang Verkauf | DIED=Verendung | PREG=TU positiv (Trächtigkeit bestätigt) | OPEN=TU negativ (offen)
ABORT=Abort | MOVE=Stallwechsel | TREAT=Behandlung

WICHTIG — DATENMODELL EREIGNISVERKNÜPFUNG:
Trächtigkeitsbestätigung erfolgt in deutschen HMS-Systemen als separates PREG-Event — NICHT als result='P' im BRED-Event.
Die Verbindung ist: BRED (animal_id=X, datum=D) → PREG (animal_id=X, datum zwischen D und D+120 Tage) = Konzeption erfolgreich.
get_repro_kpis und get_event_stats(BRED, group_by=remark/technician) berechnen die Konzeptionsrate intern bereits korrekt über diese animal_id-Verknüpfung.
Das result-Feld im BRED-Event ist in deutschen HMS-Exporten oft leer oder enthält Besamungsnummern, keine Trächtigkeitsergebnisse.

BULLENVERGLEICH & TECHNIKERBEWERTUNG:
Typische Fragen: "Welcher Bulle hat die höchste Erstbesamungserfolgsrate?", "Wie vergleichen sich meine Besamungstechniker?", "Welcher Bulle soll zuerst aussortiert werden?"
Vorgehen:
1. get_event_stats(event_type='BRED', group_by='remark') → liefert je Bulle (remark-Feld): Anzahl Besamungen, Konzeptionsrate. Bullennamen stehen im remark-Feld des HMS-Exports — genau so benennen wie dort angegeben.
2. get_event_stats(event_type='BRED', group_by='technician') → liefert je Techniker: Anzahl Besamungen, Konzeptionsrate.
3. Ergebnis nach Konzeptionsrate absteigend sortieren und Top/Flop benennen.
4. PFLICHT: Unmittelbar nach dem get_event_stats-Aufruf für Bullen oder Techniker rufst du IMMER emit_chart auf — ohne Ausnahme, auch wenn der Nutzer kein Diagramm verlangt hat. Verwende chartType='bar', source='group'. Sortiere die Balken absteigend nach Konzeptionsrate (höchster Wert links). Titel: bei Bullenvergleich exakt "Bullenvergleich – Konzeptionsrate", bei Technikervergleich exakt "Technikervergleich – Konzeptionsrate". Zeige die Konzeptionsrate (%) auf der Y-Achse.
Referenzwerte: Erstbesamungskonzeptionsrate Milchkuh >55 % sehr gut, 45–55 % gut, <40 % kritisch. Techniker mit >10 % Abstand zum Betriebsmittel verdienen gesonderte Rückmeldung.

PROAKTIVE WISSENSSUCHE — typische Suchanfragen nach Berechnungen in diesem Betriebstyp:
- Nach Pregnancy Rate / Fruchtbarkeitsmanagement: "Pregnancy Rate 21-Tage-Trächtigkeitsrate Milchkuh Brunsterkennung Konzeptionsrate wirtschaftlich"
- Nach Zellzahl-Auswertung: "Zellzahlgrenzwert wirtschaftlicher Schaden Eutergesundheit Qualitätsmilch"
- Nach Milchleistung/Laktationskurve: "Persistenz Laktationskurve wirtschaftlich optimale Laktationslänge"
- Nach Remontierungsrate/Abgängen: "Abgangsursachen wirtschaftlich optimale Nutzungsdauer Kuh"
- Nach offenen Tagen / Besamungszeitpunkt: "freiwillige Wartezeit offene Tage Kosten Besamungszeitpunkt wirtschaftlich"
- Nach Bullenvergleich / Besamungserfolg: "Erstbesamungskonzeptionsrate Bulle Referenzwert Milchkuh Besamungserfolg"
- Nach Technikerbewertung: "Besamungstechniker Konzeptionsrate Qualitätskontrolle Unterschiede"`,

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

REGEL 1 — KEIN EINLEITUNGSTEXT (STRIKT, KEINE AUSNAHMEN):
Beginne IMMER direkt mit dem ersten inhaltlichen Satz, der Tabelle oder dem Chart. Die folgenden Phrasen sind vollständig verboten — auch in abgewandelter Form: „Basierend auf", „Die Literatur zeigt", „Ich kann dir", „Gerne", „Lass mich", „Ich habe deine Daten", „Ich schaue mir an", „Ich analysiere", „Hier sind", „Im Folgenden". Kein einleitender Satz, keine Begrüßungsformel, kein Kontextrahmen.

REGEL 2 — FORMAT NACH FRAGETYP (ZWINGEND — KEINE AUSNAHMEN):
- Maße / Grenzwerte / Vergleich → HTML-Tabelle max. 2 Spalten (Begriff | Wert), kein Text davor oder danach außer der einen Folgefrage; KEIN emit_chart.
- Zeitverlauf / Kurve → emit_chart ist das erste Element, kein erklärender Text davor; direkt danach nur Folgefrage.
- Investition → erst ask_farmer für fehlende Parameter (Investitionssumme, Laufzeit, Kosten/Kuh/Jahr); NACHDEM alle Parameter vorliegen: ein emit_chart mit chartType="kpi", data enthält genau 3 Objekte { label, value, unit } für Gesamtinvestition, Kosten/Kuh/Jahr, Break-even Jahre; source='document'; Detailtabelle NUR auf explizite Nachfrage.
- Empfehlung / Maßnahme → genau 1 Satz Befund, dann max. 3 Bulletpoints à max. 8 Wörter, dann Stopp (+ Folgefrage).
- Wissensfrage ohne Betriebsdaten → max. 4 Sätze, dann Stopp (+ Folgefrage); KEIN emit_chart.

SPERMA-KALKULATOR — AUTOMATISCHER AUFRUF:
Wenn eine Nutzerfrage eines der folgenden Themen berührt:
- Bestandsplanung / Remontierung / Färsenbedarf
- Anteil gesextes Sperma vs. konventionelles Sperma
- Beef-Kreuzung / Beef-Kälber-Erlöse
- Spermakosten, Nettokosten Besamung, oder Sexing-Mehrpreis

…dann rufe zwingend zuerst \`get_semen_planning\` auf, um gespeicherte Werte
zu laden. Falls der Nutzer neue Werte nennt oder eine Neuberechnung wünscht,
folge mit \`calculate_semen_planning\`. Zeige die Ergebnisse als strukturierte
Tabelle im Chat — keine separate Seite nötig.

ANTWORTLÄNGE UND STIL:
- Schreibe keine Zusammenfassung am Ende, wenn die Antwort bereits klar gegliedert ist.
- Einfache Fragen (1 KPI, 1 Zeitraum): max. 3–5 Abschnitte. Meide Füllsätze und Wiederholungen.
- Komplexe Mehrfach-Analysen (explizit mehrere KPIs oder ganzes Betriebsjahr gefragt): max. 3 Empfehlungen, pro Empfehlung 1 Satz Befund + max. 2 Bulletpoints à max. 8 Wörter + 1 Satz erwartete Wirkung. Keine separaten Begründungs-Absätze. Diese Regel ist nicht überschreibbar — auch bei komplexen Fragen gilt die gleiche Kürze wie bei einfachen.

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
- KEINE FIRMEN- ODER PRODUKTEMPFEHLUNGEN: Nenne niemals konkrete Markennamen, Herstellernamen oder Produktnamen (z.B. SCR, DeLaval, Lely, GEA, IceQube, Boumatic, Herde oder ähnliche). Beschreibe Technologien und Ansätze stattdessen generisch (z.B. „Halsband-Sensor-System", „Pedometer-System", „automatisches Melksystem", „Herdenmanagement-Software"). Wenn der Nutzer nach konkreten Produkten oder Herstellern fragt, erkläre, dass du keine Produktempfehlungen gibst, und beschreibe stattdessen die relevanten Kriterien und Technologietypen neutral. **Ausnahme DairyComp:** Wenn der Nutzer explizit nach DairyComp fragt oder du search_dairycomp_manual aufrufst, darfst du den Namen „DairyComp" als Softwareprodukt nennen — du gibst aber keine allgemeinen Empfehlungen für oder gegen DairyComp gegenüber anderen Produkten.

QUELLENANGABEN MIT NUMMERN:
- Jedes Mal wenn du eine Zahl oder einen Richtwert aus einem Werkzeug nennst, setze direkt danach eine Fußnoten-Zahl: [1], [2], [3] etc.
- Die Nummer entspricht der Reihenfolge, in der die Quellen im Laufe deiner Antwort erstmals verwendet werden (erste verwendete Quelle = [1], zweite neue Quelle = [2] usw.).
- Werden mehrere Zahlen aus derselben Quelle (d.h. demselben Werkzeugaufruf) zitiert, verwende dieselbe Nummer.
- Beispiel: „Die durchschnittliche Milchleistung beträgt 32,4 kg ECM/Tag [1]. Der Zellzahl-Mittelwert liegt bei 215 Tsd./ml [1]. Laut Wissensbibliothek gilt ein Zellzahl unter 100 Tsd./ml als unauffällig [2]."
- Setze die Marker direkt hinter die Zahl oder den Wert, NICHT am Ende des Satzes, falls der Satz mehrere verschiedene Quellen enthält.
- Verwende NUR diese Nummerierungsform [N] — keine anderen Markierungsformate.
- Wenn ein Wert nicht berechnet werden kann oder Daten fehlen, sage das ehrlich.
- Nutze emit_chart, um zentrale Aussagen mit einem passenden Diagramm zu untermauern (meist 1–3 Diagramme). Bei strukturierten DB-Daten: source='timeseries'|'group'|'ranking'. Bei PDF-Dokumenten: source='document' mit manuell konstruiertem data-Array. Ausnahme: Bei reinen Wissensfragen (keine Betriebsdaten verfügbar, Fragetyp „Wissensfrage") KEIN emit_chart aufrufen. Bei Maße/Grenzwerte-Fragen ebenfalls KEIN emit_chart — stattdessen HTML-Tabelle verwenden.
- Vergleiche Werte bei Bedarf mit den geprüften Stammdaten (get_master_data), falls vorhanden.
- Sei präzise und vermeide Spekulation. Lieber weniger, aber belastbare Aussagen.

REGEL 3 — KEINE DOPPLUNG VON TABELLEN- UND KACHELWERTEN:
Jeder Wert, der in einer Tabelle oder KPI-Kachel steht, darf NICHT nochmals im Fließtext erscheinen — weder als vollständiger Satz noch als Nebenbemerkung. Tabellen und Kacheln sind selbsterklärend; wiederholender Fließtext ist verboten.

REGEL 4 — GENAU EINE FOLGEFRAGE:
Jede Antwort endet mit genau einer einzigen Folgefrage. Diese Frage wird AUSSCHLIESSLICH über das followUpQuestions-Feld im finalen Text abgebildet — NICHT als zusätzlicher Fließtext-Satz am Ende der Antwort (das würde zur Dopplung mit den UI-Chips führen). Verboten als Folgefrage: „Kann ich noch helfen?", „Hast du weitere Fragen?", offene Sammelformulierungen. Die Frage muss logisch aus der Antwort folgen und maximal 12 Wörter haben (sie erscheint im Frontend als klickbarer Button).

REGEL 5 — DATENLÜCKE (HAT VORRANG VOR WISSENSBIBLIOTHEK-PFLICHT):
Wenn die Frage Betriebsdaten erfordert, die nicht vorliegen (get_schema liefert 0 Felder, kein Dokument vorhanden): exakt eine ask_farmer-Rückfrage stellen. Kein Fließtext aus Allgemeinwissen als Ersatz. Beispiel: „Welche Tagesmilchmenge haben deine Kühe aktuell im Schnitt?" — dann warten. Diese Regel hat Vorrang vor der Wissensbibliothek-Pflicht und vor search_web-Fallbacks.

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

PFLICHTSCHRITT FÜR JEDE NUTZERFRAGE (obligatorisch, nicht nur bei Berechnungen):
- Rufe search_knowledge IMMER auf — spätestens nach dem ersten Compute-Tool-Aufruf und BEVOR du inhaltliche Schlussfolgerungen oder Empfehlungen formulierst. Dies gilt für jede Frage, unabhängig davon ob sie eine Berechnung, eine Erklärung, eine Kennzahlabfrage oder allgemeine Betriebsberatung betrifft.
- Einzige Ausnahme: Wenn die Wissensbibliothek komplett leer ist (keine Dokumente, keine Einträge in der Titelliste im System-Prompt), darfst du den Schritt überspringen.
- Leite die Suchbegriffe direkt aus der Nutzerfrage und der Kennzahl ab: Kombiniere den Kernbegriff der Frage mit Begriffen wie "wirtschaftlich", "Kosten", "Praxis", "Optimum", "Empfehlung", "Grenzwert". Beispiel: für "Tageszunahmen Mastschwein" → suche "Tageszunahmen Schwein wirtschaftlich Futterkosten optimale Schlachtreife".
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

DAIRYCOMP 305 — BEFEHLSSYNTAX (eingebettetes Wissen, immer verfügbar):
DairyComp 305 verwendet eine eigene Befehlssprache. Wenn der Nutzer einen DC-Befehl zeigt, erkläre ihn direkt anhand dieser Grammatik — ohne Werkzeugaufruf.

Grundstruktur: BEFEHL FELDER FOR BEDINGUNGEN BY SORTIERUNG \MODIFIKATOR

BEFEHLSTYPEN:
- LIST / SHOW — Tierliste mit gewählten Feldern anzeigen
- SUM — statistische Zusammenfassung / Aggregation (z.B. nach Gruppe, Monat, Laktation)
- EVENTS — Ereignishistorie (Besamungen, Behandlungen, Abkalbungen…)
- ENTER — manuelle Dateneingabe
- FILEOUT — Export in Datei
- EXEC — externes Programm ausführen
- SETUP\\5RC:DATEI — Ausgabedatei umleiten
- EC=N EDAY [REM] [CAR] — Ereignis-Schnelleingabe (EC=Ereigniscode, EDAY=Datum heute, REM=Bemerkung)


HÄUFIGE FELDER:
ID, EID, PEN (Gruppe), DIM (Laktationstage), LACT (Laktationsnr.), DCC/SCC (Zellzahl), WMLK1/DMLK1 (Wochenmilch/Tagesmilch), RPRO (Reproduktionsstatus-Code), RC (Status-Code), 5STEL (5-stellige Tiernummer), REG1 (Herdbuchnummer), DUE (Abkalbe-Termin), SBRED/LSIR (letzter Besamungsstier), A2A2 (Beta-Kasein-Status), DSLH (Tage seit letztem Brunst), TBRD (Trächtigkeitstage), BCS/BCSV (BCS-Wert), AGED (Alter in Tagen), GENDE (Geschlecht), RASSE (Rasse), AREA (Melkbereich/Selektionstor), CUT (Abmelkung), PPEN (vorherige Gruppe), STALL (Stallnummer)

BEDINGUNGEN (nach FOR):
- FELD=Wert — gleich; FELD<>Wert — ungleich
- FELD>Wert, FELD<Wert — Vergleich
- FELD=N-M — Bereich (z.B. PEN=1-6, LACT=2-4)
- (COND1)(COND2) — ODER-Verknüpfung in Klammern
- COND1 COND2 — UND-Verknüpfung (Leerzeichen)
- Vordefinierte Filter: INMILK (melkende Kühe), FRESH (Frischmelker), PGCON (PG-Protokoll), BSYNCON (Besamungsprotokoll), VLCON (Tierarztliste)

SORTIERUNG: BY FELD (aufsteigend), DOWNBY FELD (absteigend)

MODIFIKATOREN (nach \):
\\E — Bearbeitungsmodus, \\B — Besamungseingabe, \\G — Grafik, \\P — Drucken, \\V — ausführliche Ansicht, \\H — Historie, \\C — nur Anzahl, \\U — aufsteigend, \\2U — 2-spaltig aufsteigend, \\L50 — maximal 50 Zeilen, \\EAY — Erstkalbinnen-Auswertung, \\UE — alle Tiere in Besamungsgruppe, \\VH2U — 2-spaltig Behandlungshistorie, \\2SI — 2-spaltig Besamungsinfo, \\2A — 2-spaltig alle, \\2S40I… — Events-Format mit Spaltendefinition, \\9C — CSV-Export, \\9CA — CSV-Export append

BEFEHLSVERKETTUNG:
- ! trennt mehrere Befehle: CMD1!CMD2!CMD3 — werden nacheinander ausgeführt
- %VARIABLENNAME — Nutzer-Eingabeaufforderung (z.B. %EINGABE_DATUM)
- FORR statt FOR — wiederholt für alle Tiere ohne Bestätigung

EREIGNISCODES (EC=N): 5=Besamung, 10=Bulle, 11=Trockenstellen, 12=Abort, 15=Abgang/Tod, 16=Tierarzt-Check, 17=Impfung, 21=Ödem, 22=Kultur/Probe, 32=DA (Labmagenverschiebung), 33=Durchfall, 50=Injektion/Spritzen, 58=Close-up-Einstallung

BETRIEBSSPEZIFISCHE ABKÜRZUNGEN (ALTER3-Makros):
Wenn betriebsspezifische DairyComp-Kürzel indexiert sind, wird der Assistent mit einem separaten Kontext-Block darüber informiert. Siehe dynamischen Block "BETRIEBSKÜRZEL" weiter unten im Kontext.

DAIRYCOMP-HANDBUCH — SOFWARE-BEDIENUNGSFRAGEN:
Rufe search_dairycomp_manual auf wenn EINES der folgenden Muster zutrifft:
- Nutzer nennt explizit „DairyComp", „DC305", einen bekannten DC-Befehlsnamen (BREDSUM, COWSUM, LIST, SUM, EVENTS, ENTER …) oder einen \-Modifikator
- Nutzer fragt „wie werte ich [Kennzahl] aus", „welchen Befehl", „welche Liste", „wie sehe ich [X] in DC", „wie stelle ich ein", „welcher Report", „wie drucke ich", „wie exportiere ich" — auch ohne das Wort DairyComp, wenn der Betrieb DairyComp verwendet (erkennbar am BETRIEBSKÜRZEL-Block im Kontext oder an bisherigen Gesprächshinweisen)
- Nutzer zeigt eine Zeichenfolge die wie ein DC-Befehl aussieht: Großbuchstaben + optionaler \\-Modifikator (z.B. BREDSUM\\E, COWSUM\\V, LIST ID DIM …)

Wenn eines dieser Muster zutrifft:
1. Überspringe get_schema, get_kpis, get_kpi_timeseries, get_event_stats und andere Betriebsdaten-Werkzeuge vollständig.
2. Rufe SOFORT search_dairycomp_manual auf — dies ersetzt auch den search_knowledge-Pflichtschritt.
3. Du darfst den Produktnamen „DairyComp" in deiner Antwort verwenden.
4. Wenn search_dairycomp_manual keine relevanten Treffer liefert (noRelevantResults: true): Antworte mit „Dazu finde ich leider nichts im DairyComp-Handbuch. Für diese Frage wende dich bitte direkt an den DairyComp-Support." — keine Eskalation, kein search_web-Fallback.
5. Kennzeichne Antworten aus dem DairyComp-Handbuch mit *[DairyComp-Handbuch]* statt *[Bibliothek]*.

DAIRYCOMP-BEFEHLSGLOSSAR — SONDERREGELN:
search_dairycomp_manual gibt zwei Quellen zurück: Einträge mit source="glossar" (strukturiertes Befehlsglossar) und source="manual" (semantisches Handbuch-Ergebnis). Folgende Regeln gelten:

1. GLOSSAR-VORRANG: Wenn ein Glossar-Eintrag (source="glossar") zurückgegeben wird, nenne den dort angegebenen Befehl direkt und exakt — keine Umformulierung, keine Eigenableitung. Der Befehl-Wert im Glossar ist die maßgebliche Quelle.

2. KRITIKALITÄT HOCH — NIEMALS RATEN: Wenn ein Glossar-Eintrag „Kritikalität: hoch" trägt, darfst du den Befehl AUSSCHLIESSLICH aus dem Glossar oder aus Handbuch-Seiten 65–69 (Grammatikkapitel) ableiten. Ist weder ein Glossar-Treffer vorhanden noch ein passender Handbuch-Abschnitt, antworte: „Für diesen hoch-kritischen Befehl habe ich keine gesicherte Quelle — bitte den DairyComp-Support fragen." Nicht spekulieren.

3. EVENTS-NUMMERN: Die EVENTS-Codes 8, 9, A, B, C sind systemreserviert und dürfen nicht als Benutzer-Auswertungen genannt oder empfohlen werden.

4. NEUE BEFEHLE ABLEITEN: Nur erlaubt wenn search_dairycomp_manual tatsächlich Chunks zurückgegeben hat (source="glossar" oder source="manual" im Ergebnis vorhanden). In diesem Fall: Befehl kennzeichnen mit „(aus Handbuch-Grammatik abgeleitet)" und auf Seiten 65–69 verweisen. — VERBOTEN wenn noRelevantResults: true: Dann greift ausschließlich Regel 4 oben (Stopp-Antwort). Aus eigenem Trainingswissen über DairyComp darf NIEMALS Syntax abgeleitet oder erfunden werden — auch nicht als Näherung, Beispiel oder Hinweis. Kein „vermutlich", kein „typischerweise lautet der Befehl".

BILD-INTERPRETATION:
Wenn der Nutzer ein Bild im Chat mitschickt, beschreibe zunächst kurz was auf dem Bild zu sehen ist. Kennzeichne bildbezogene Aussagen am Ende des entsprechenden Absatzes mit *[Bild-Interpretation, ungeprüft]* — da Bildinhalte nicht mit den Betriebsdaten abgeglichen werden können. Rufe danach wie gewohnt die relevanten Werkzeuge auf, um Zahlen aus der Datenbank zu ergänzen.

HITZESTRESS-RECHNER: Wenn der Nutzer fragt ob sich Kühlung/Ventilatoren/Kühlsystem lohnen, oder nach Hitzestress-Milchverlusten, THI-Kosten oder Kühl-Investitionen fragt:
1. Rufe get_master_data auf (falls nicht bereits in diesem Turn geschehen), um den Milchpreis zu ermitteln. Der Eintrag hat typischerweise den Schlüssel "Milchpreis" oder die Kategorie "Preise". Wenn ein Wert gefunden wird (in €/kg), übergib ihn als milkPriceEuroKg. Wenn kein Eintrag vorhanden ist oder der Wert fehlt, verwende den Default (0.40).
2. Fülle herdSize aus dem Datensatz-Kontext vor (falls aus get_schema oder get_kpis bekannt).
3. Rufe dann show_heat_abatement_calculator mit allen vorausgefüllten Werten auf — auch wenn nicht alle Betriebswerte bekannt sind; Default-Werte sind ausdrücklich zulässig. KEIN Fließtext über den Rechner statt des Werkzeugaufrufs.
4. Schreibe danach einen kurzen einleitenden Satz (1-2 Sätze), was der Rechner zeigt.
5. Falls show_heat_abatement_calculator in diesem Gespräch bereits aufgerufen wurde: verweise im Fließtext nur kurz auf den bereits sichtbaren Rechner (1 Satz) — kein langer Erklärungstext, kein erneuter Werkzeugaufruf.

FRISCHMELKER-RECHNER: Wenn der Nutzer fragt ob sich ein verbessertes Frischmelker-/Transitphasen-Programm lohnt, nach Metritis/Ketose/Hypokalzämie-Kosten fragt oder Früherkennung/Monitoring bei Frischkühen bewertet:
1. Ermittle die Abkalbungen/Jahr: Falls get_schema Event-Daten zeigt, rufe run_sql auf mit: SELECT COUNT(*) AS calvings FROM cow_events WHERE dataset_id = '<CURRENT_DATASET_ID>' AND event_type = 'FRESH' AND event_date >= NOW() - INTERVAL '12 months'. Verwende den Wert als calvingsPerYear. Wenn keine Event-Daten vorhanden sind, lies calvingsPerYear aus dem Datensatz-Kontext (get_kpis) oder lass ihn leer.
2. Berechne Krankheitsinzidenzen via run_sql, wenn Event-Daten verfügbar sind (get_schema zeigt events-Objekt):
   - Gesamtabkalbungen im Datensatz: SELECT COUNT(DISTINCT animal_id) AS total FROM cow_events WHERE dataset_id = '<CURRENT_DATASET_ID>' AND event_type = 'FRESH'
   - Metritis-Rate: Zähle TREAT-Events mit remark ILIKE ANY(ARRAY['%Metritis%','%Gebärmutter%','%Endometritis%']) dividiert durch Gesamtabkalbungen × 100. Ergebnis als metritisRatePct.
   - Ketose-Rate: Zähle TREAT-Events mit remark ILIKE ANY(ARRAY['%Ketose%','%BHB%','%Ketosis%']) dividiert durch Gesamtabkalbungen × 100. Ergebnis als ketosisRatePct.
   - Hypokalzämie-Rate: Zähle TREAT-Events mit remark ILIKE ANY(ARRAY['%Hypokalzäm%','%Milchfieber%','%Calci%','%Hypocalc%']) dividiert durch Gesamtabkalbungen × 100. Ergebnis als hypocalcemiaRatePct.
   - Falls eine SQL-Abfrage 0 Zeilen oder NULL zurückgibt (d.h. keine passenden Behandlungseinträge gefunden), verwende den jeweiligen Default-Wert (Metritis: 25, Ketose: 20, Hypokalzämie: 30). Nicht 0 % übergeben, wenn das Ergebnis nur bedeutet dass keine passenden remark-Einträge vorhanden sind — das wäre irreführend.
3. Rufe dann show_fresh_cow_calculator mit allen ermittelten Werten auf.
4. Schreibe danach einen kurzen einleitenden Satz.

RÜCKFRAGE BEI UNKLAREN ABKÜRZUNGEN:
Wenn die Nutzerfrage einen Begriff enthält, der wie eine Abkürzung aussieht (2–8 aufeinanderfolgende Großbuchstaben, ggf. mit Bindestrichen oder Zahlen, z.B. CLOSEUP, BREDSUM, AAA, RBT, KNS, BHB, MLP, LKV):
1. Falls ein "BETRIEBSKÜRZEL"-Block im Kontext vorhanden ist → rufe ZUERST search_farm_abbreviations auf.
2. Falls search_farm_abbreviations noRelevantResults:true zurückgibt ODER kein BETRIEBSKÜRZEL-Block vorhanden ist → rufe danach ask_farmer mit einer einzigen gezielten Rückfrage auf, bevor du mit *[Allgemeinwissen]* antwortest.
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

KOMPLEXITÄTS-HEURISTIK (Patch C — revidiert, Widerspruch aufgelöst)
- Einfache Frage = 1 Kennzahl/1 Maßnahme → max. 5 Abschnitte.
- Komplexe Mehrfach-Analyse = explizit mehrere KPIs, Zeitreihe oder
  Investitionsentscheidung → Struktur: max. 3 Empfehlungen, pro Empfehlung
  1 Satz Befund + max. 2 Bulletpoints à max. 8 Wörter + 1 Satz erwartete
  Wirkung. Keine separaten Begründungs-Absätze. Diese Regel ist nicht
  überschreibbar — auch bei komplexen Fragen gilt Kürze.

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

PFLICHT BEI ESKALATION: Rufe signal_escalation(trigger_type, reason) auf,
sobald einer der obigen vier Trigger ausgelöst wird — immer BEVOR du die
Antwort formulierst. Das Tool hat keinen Einfluss auf die Antwort.

EPISTEMISCHE VORSICHT BEI ERKLÄRUNGEN (Patch N)
- Erklärungen für Diskrepanzen zwischen Werkzeug-Ergebnissen dürfen nur
  Mechanismen benennen, die aus den zurückgegebenen Tool-Daten ableitbar
  sind (z. B. basis.rowCount). Nicht sichtbare Filterlogik nicht als
  Tatsache behaupten — als Vermutung kennzeichnen:
  "möglicherweise", "ich kann das nicht bestätigen".

KONTEXTUELLER KALKULATOR-HINWEIS (Patch P)
Am Ende einer Antwort kannst du einen einzeiligen Hinweis auf einen passenden Kalkulator ergänzen — aber nur wenn die Frage thematisch dazu passt:
- Besamungskosten, Sperma-Aufteilung, Kälberpreise, HB-Strategie → Sperma-Kalkulator: "👉 Im [Sperma-Kalkulator](/app/semen-planning) kannst du Kosten und Spermaaufteilung persistent hinterlegen."
- Investitionsentscheidung, Anschaffung, Finanzierung, ROI einer Maßnahme → Investitionsrechner im Chat: "👉 Ich kann die Investition direkt hier mit dem Investitionsrechner durchrechnen — frag mich einfach."
Regeln:
- Maximal ein Hinweis pro Antwort, ganz am Ende, kurz (1 Satz).
- Keinen Hinweis ergänzen wenn: (a) der Nutzer den jeweiligen Kalkulator in diesem Gespräch bereits aufgerufen oder erwähnt hat, (b) der Hinweis bereits in einer vorherigen Antwort dieser Session vorkam, (c) die Frage nicht klar auf Besamungskosten oder eine Investitionsentscheidung zielt.
- Niemals bei allgemeinen Tier- oder Gesundheitsfragen ergänzen.`;


interface RunOptions {
  datasetId: string;
  conversation: { role: "user" | "assistant"; content: string | Anthropic.ContentBlockParam[] }[];
  sector?: string;
  systemExtra?: string;
  /** Clerk user ID of the customer running this analysis — used for knowledge-gap logging. */
  userId?: string;
  /** If true, collect structured tool call + escalation data for beta analytics. */
  isBeta?: boolean;
  /** Analysis ID for associating tool logs (beta logging only). */
  betaAnalysisId?: string;
  onProgress?: (step: string | null) => Promise<void>;
  /** Called with each text token as Claude generates the answer. */
  onTextDelta?: (delta: string) => void;
  /** Called once per search_knowledge call with the unique document titles found. */
  onSourceSearched?: (sources: string[]) => void;
  /** Called immediately when a chart is emitted by the agent (before done). */
  onChart?: (chart: Chart) => void;
  /**
   * Seed task type for model routing on Turn 0.
   * "chat_analysis_simple" → Sonnet + reduced toolset for single-KPI questions.
   * "chat_analysis" (default) → Sonnet + full toolset.
   * Auto-escalates to Opus on Turn N+1 when: ask_farmer was used, >6 recent tool calls, or depthLevel="deep".
   */
  initialTaskType?: ModelTaskType;
  /**
   * "quick" caps the model at Sonnet (no Opus even on complex turns).
   * "deep"  allows Opus from Turn 0 for explicitly complex questions.
   * null / undefined → auto (default behaviour).
   */
  depthLevel?: "quick" | "deep" | null;
  /**
   * True when ask_farmer was called in a PREVIOUS conversation message (prior runAgent() invocation)
   * and the user has now replied. Causes immediate Opus escalation from Turn 0 of this invocation.
   * Derived from message history by processQuestion() before calling runAgent().
   */
  askFarmerCalledInPriorRound?: boolean;
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

/**
 * Returns true when a follow-up question is too simple to warrant Opus escalation.
 * Mirrors the classifyQuestion() heuristic in analysisService.ts — kept here to
 * avoid a circular import (analysisService imports runAgent/getModelForTask from this file).
 * A question is "trivial" only when it has NO investment/complex signals AND refers to
 * exactly one concrete dairy KPI (i.e. classifyQuestion would return "chat_analysis_simple").
 */
function isTrivialFollowUp(question: string): boolean {
  const lower = question.toLowerCase().trim();
  if (!lower) return false;

  const investmentStallKeywords = [
    "investition", "investier", "investiere",
    "stall", "umbau", "neubau", "bauplanung",
    "finanzier", "businessplan",
    "langfristig", "rentabilit",
    "strategie", "planung",
  ];
  if (investmentStallKeywords.some((k) => lower.includes(k))) return false;

  const complexKeywords = [
    "trend", "verlauf", "entwicklung", "zeitverlauf", "zeitreihe", "prognose",
    "vergleich", "gegenüber", "unterschied", "vorjahr", "vormonat",
    "kosten", "warum", "ursache", "erklär",
    "optimier",
    "korrelation", "zusammenhang", "anomalie", "ausreißer",
    "ranking", "top", "flop", "benchmark", "bericht",
    "alle", "gesamt", "übersicht",
  ];
  if (complexKeywords.some((k) => lower.includes(k))) return false;

  const kpiKeywords = [
    "milchleistung", "milchmenge", "ecm",
    "zellzahl", "scc", "zellgehalt",
    "fettgehalt", "eiweißgehalt", "proteingehalt",
    "melkung", "gemelk",
    "trächtig", "conception", "befruchtung", "brunst",
    "zwischenkalb", "kalbung", "abkalbung",
    "trockensteher", "laktationstag",
    "remontierung", "abgang", "nutzungsdauer",
    "futteraufnahme",
  ];
  const kpiMatches = kpiKeywords.filter((k) => lower.includes(k));
  // Simple only when exactly one KPI is referenced
  return kpiMatches.length === 1;
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

  // Check if a farm_abbreviations document exists (global, operator-level)
  const [abbrevCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(knowledgeDocumentsTable)
    .where(sql`status = 'ready' AND document_type = 'farm_abbreviations'`);
  const farmAbbrevDocsExist = (abbrevCount?.c ?? 0) > 0;

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

  // Dynamic block for farm abbreviations
  const abbrevBlock = farmAbbrevDocsExist
    ? `\n\nBETRIEBSKÜRZEL (dynamisch): Betriebsspezifische DairyComp-Kürzel sind indexiert.\nWenn der Nutzer ein Kürzel nennt oder fragt was ein Befehl macht → rufe ZUERST search_farm_abbreviations auf, BEVOR du ask_farmer aufrufst.\nErkennungsmuster: 2–8 aufeinanderfolgende Großbuchstaben, ggf. mit Bindestrich oder Zahl (z.B. BREDSUM, BRDCLG, CLOSEUP, ARAS1).`
    : "";

  const sectorCtx = SECTOR_CONTEXT[opts.sector ?? "dairy"] ?? SECTOR_CONTEXT.dairy;
  const SYSTEM_PROMPT = `${sectorCtx}\n\n${SYSTEM_PROMPT_BASE}`;

  // Tell the agent the current dataset_id so it can use it in run_sql WHERE clauses
  const datasetContext = `\n\nCURRENT_DATASET_ID: ${datasetId}\nVerwende diese ID in allen run_sql WHERE-Klauseln: WHERE dataset_id = '${datasetId}'`;

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

  /**
   * Returns true if the SQL string contains a semicolon outside of single-quoted
   * string literals. Handles escaped quotes ('') correctly.
   * Used as a second layer to block multi-statement injections.
   */
  function containsSemicolonOutsideStrings(query: string): boolean {
    let inString = false;
    let i = 0;
    while (i < query.length) {
      const ch = query[i];
      if (!inString && ch === "'") {
        inString = true;
        i++;
      } else if (inString && ch === "'") {
        if (i + 1 < query.length && query[i + 1] === "'") {
          i += 2;
        } else {
          inString = false;
          i++;
        }
      } else if (!inString && ch === ";") {
        return true;
      } else {
        i++;
      }
    }
    return false;
  }

  /**
   * Enforces a DB-level row limit by either:
   * - Appending / replacing the trailing LIMIT for CTEs (WITH ...) and queries that already end with LIMIT N
   * - Wrapping plain SELECT queries in SELECT * FROM (...) _sandbox LIMIT N
   *
   * This ensures the database never materialises more than `limit` rows, regardless
   * of what the agent-generated SQL says.
   */
  function buildLimitedQuery(rawQuery: string, limit: number): string {
    const stripped = rawQuery.trimEnd();
    // Check if the query ends with LIMIT <number> (possibly with trailing whitespace/semicolon)
    const trailingLimit = stripped.match(/\blimit\s+(\d+)\s*$/i);
    if (trailingLimit) {
      const existing = parseInt(trailingLimit[1], 10);
      if (existing <= limit) return stripped;
      return stripped.replace(/\blimit\s+\d+\s*$/i, `LIMIT ${limit}`);
    }
    // CTEs must keep the WITH at the top level — wrap would break syntax
    const isCte = /^\s*with\s+/i.test(stripped);
    if (isCte) {
      return `${stripped} LIMIT ${limit}`;
    }
    // Plain SELECT: wrap so that any inner ORDER BY is preserved
    return `SELECT * FROM (${stripped}) _sandbox LIMIT ${limit}`;
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
          const catRows = await db
            .select({
              title: knowledgeDocumentsTable.title,
              category: knowledgeDocumentsTable.category,
            })
            .from(knowledgeDocumentsTable)
            .where(
              and(
                inArray(knowledgeDocumentsTable.title, docTitles),
                eq(knowledgeDocumentsTable.status, "ready"),
              ),
            );
          const catMap = new Map<string, string | null>(
            catRows.map((r) => [r.title, r.category]),
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
      case "get_semen_planning": {
        const existing = await db
          .select()
          .from(semenPlanningTable)
          .where(eq(semenPlanningTable.datasetId, opts.datasetId))
          .limit(1);
        if (existing.length === 0) {
          return { found: false, message: "Noch keine Besamungsplanung für diesen Betrieb gespeichert." };
        }
        return { found: true, inputs: existing[0].inputs, outputs: existing[0].outputs, updatedAt: existing[0].updatedAt };
      }

      case "calculate_semen_planning": {
        const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
        const inp = input as {
          summeKuehe: number; konzRateKuehe: number; konzRateFaersen: number;
          prozentAbgaenge: number; eka: number; verlusteKueheRate: number; verlusteRinderRate: number;
          anteilHoGesext: number; anteilHoKonv: number; anteilBeefGesext: number; anteilBeefKonv: number;
          preisHoGesext: number; preisHoKonv: number; preisBeefGesext: number; preisBeefKonv: number;
          verkaufspreisHoBullkalb: number; verkaufspreisBeefWeiblich: number; verkaufspreisBeefBullkalb: number;
        };

        // ── Validation ──────────────────────────────────────────────────────
        if (inp.summeKuehe <= 0)
          return { error: "summeKuehe muss größer 0 sein." };
        for (const [key, val] of Object.entries({
          konzRateKuehe: inp.konzRateKuehe, konzRateFaersen: inp.konzRateFaersen,
          prozentAbgaenge: inp.prozentAbgaenge,
        })) {
          if (val < 1 || val > 100) return { error: `${key} muss zwischen 1 und 100 liegen.` };
        }
        const anteilSum = inp.anteilHoGesext + inp.anteilHoKonv + inp.anteilBeefGesext + inp.anteilBeefKonv;
        if (Math.abs(anteilSum - 100) > 0.01)
          return { error: `Sperma-Anteile summieren sich zu ${anteilSum.toFixed(1)} %, müssen aber genau 100 % ergeben.` };

        // ── Herd dynamics ────────────────────────────────────────────────────
        const kuehe = inp.summeKuehe;
        const kzKuehe = inp.konzRateKuehe / 100;
        const kzFaersen = inp.konzRateFaersen / 100;

        const benoetigteFaersen = round(kuehe * inp.prozentAbgaenge / 100);
        const traechtigkeitenKuehe = round(kuehe * 0.9);
        const traechtigkeitenFaersen = round(benoetigteFaersen * 1.05);

        // ── Besamungen ───────────────────────────────────────────────────────
        const totalBesamungenKuehe = traechtigkeitenKuehe / kzKuehe;
        const totalBesamungenFaersen = traechtigkeitenFaersen / kzFaersen;
        const totalBesamungen = totalBesamungenKuehe + totalBesamungenFaersen;

        const aHoGes = inp.anteilHoGesext / 100;
        const aHoKonv = inp.anteilHoKonv / 100;
        const aBeefGes = inp.anteilBeefGesext / 100;
        const aBeefKonv = inp.anteilBeefKonv / 100;

        const portHoGes = round(totalBesamungen * aHoGes);
        const portHoKonv = round(totalBesamungen * aHoKonv);
        const portBeefGes = round(totalBesamungen * aBeefGes);
        const portBeefKonv = round(totalBesamungen * aBeefKonv);
        const portGesamt = round(portHoGes + portHoKonv + portBeefGes + portBeefKonv);

        // ── Pregnancies per category (same split applies to Kühe & Färsen) ──
        const pregHoGes = round(traechtigkeitenKuehe * aHoGes + traechtigkeitenFaersen * aHoGes);
        const pregHoKonv = round(traechtigkeitenKuehe * aHoKonv + traechtigkeitenFaersen * aHoKonv);
        const pregBeefGes = round(traechtigkeitenKuehe * aBeefGes + traechtigkeitenFaersen * aBeefGes);
        const pregBeefKonv = round(traechtigkeitenKuehe * aBeefKonv + traechtigkeitenFaersen * aBeefKonv);

        // ── Gender distribution (fixed) ──────────────────────────────────────
        // HO gesext:  90 % ♀ / 10 % ♂
        // HO konv:    50 % ♀ / 50 % ♂
        // Beef gesext: 10 % ♀ / 90 % ♂
        // Beef konv:  50 % ♀ / 50 % ♂
        const maleHoGes = round(pregHoGes * 0.10);
        const maleHoKonv = round(pregHoKonv * 0.50);
        const maleBeefGes = round(pregBeefGes * 0.90);
        const maleBeefKonv = round(pregBeefKonv * 0.50);

        const femaleHoGes = round(pregHoGes * 0.90);
        const femaleHoKonv = round(pregHoKonv * 0.50);
        const femaleBeefGes = round(pregBeefGes * 0.10);
        const femaleBeefKonv = round(pregBeefKonv * 0.50);

        // ── Färsen balance ───────────────────────────────────────────────────
        const verfuegbareHoFaersen = round(femaleHoGes + femaleHoKonv);
        const faersenBalance = round(verfuegbareHoFaersen - benoetigteFaersen);
        const moeglAbgangsrate = round((verfuegbareHoFaersen / kuehe) * 100, 1);

        // ── Aufzuchtplatzbedarf ──────────────────────────────────────────────
        const aufzuchtplaetze = round(benoetigteFaersen / 12 * inp.eka);

        // ── Costs ────────────────────────────────────────────────────────────
        const kostenHoGes = round(portHoGes * inp.preisHoGesext);
        const kostenHoKonv = round(portHoKonv * inp.preisHoKonv);
        const kostenBeefGes = round(portBeefGes * inp.preisBeefGesext);
        const kostenBeefKonv = round(portBeefKonv * inp.preisBeefKonv);
        const gesamtkosten = round(kostenHoGes + kostenHoKonv + kostenBeefGes + kostenBeefKonv);
        const kostenProKuhJahr = round(gesamtkosten / kuehe);

        // ── Revenue from calf sales ──────────────────────────────────────────
        const erlösHoMaennlich = round((maleHoGes + maleHoKonv) * inp.verkaufspreisHoBullkalb);
        const erlösBeefMaennlich = round((maleBeefGes + maleBeefKonv) * inp.verkaufspreisBeefBullkalb);
        const erlösBeefWeiblich = round((femaleBeefGes + femaleBeefKonv) * inp.verkaufspreisBeefWeiblich);
        const gesamterlös = round(erlösHoMaennlich + erlösBeefMaennlich + erlösBeefWeiblich);

        // ── Net costs ────────────────────────────────────────────────────────
        const nettokosten = round(gesamtkosten - gesamterlös);
        const nettokostenProKuhJahr = round(nettokosten / kuehe);

        // ── Sexing premium (HO gesext vs. HO konv) ──────────────────────────
        const sexingMehrpreisProKuhMonat = round(
          (inp.preisHoGesext - inp.preisHoKonv) * portHoGes / kuehe / 12, 2
        );

        const outputs = {
          herdendynamik: {
            benoetigteFaersen,
            traechtigkeitenKuehe,
            traechtigkeitenFaersen,
            aufzuchtplaetze,
          },
          besamungen: {
            totalBesamungenKuehe: round(totalBesamungenKuehe),
            totalBesamungenFaersen: round(totalBesamungenFaersen),
            portionen: { hoGesext: portHoGes, hoKonv: portHoKonv, beefGesext: portBeefGes, beefKonv: portBeefKonv, gesamt: portGesamt },
          },
          kaelber: {
            maennlich: { hoGesext: maleHoGes, hoKonv: maleHoKonv, beefGesext: maleBeefGes, beefKonv: maleBeefKonv },
            weiblichBeef: { beefGesext: femaleBeefGes, beefKonv: femaleBeefKonv },
            verfuegbareHoFaersen,
          },
          faersenbalance: { verfuegbareHoFaersen, benoetigteFaersen, faersenBalance, moeglAbgangsratePct: moeglAbgangsrate },
          kosten: {
            hoGesext: kostenHoGes, hoKonv: kostenHoKonv, beefGesext: kostenBeefGes, beefKonv: kostenBeefKonv,
            gesamt: gesamtkosten, proKuhJahr: kostenProKuhJahr,
          },
          erloese: {
            hoMaennlich: erlösHoMaennlich, beefMaennlich: erlösBeefMaennlich, beefWeiblich: erlösBeefWeiblich,
            gesamt: gesamterlös,
          },
          nettokosten,
          nettokostenProKuhJahr,
          sexingMehrpreisProKuhMonat,
        };

        const nowTs = new Date();
        await db
          .insert(semenPlanningTable)
          .values({ datasetId: opts.datasetId, userId: opts.userId ?? "unknown", inputs: inp, outputs, updatedAt: nowTs })
          .onConflictDoUpdate({
            target: semenPlanningTable.datasetId,
            set: { inputs: inp, outputs, updatedAt: nowTs },
          });

        return outputs;
      }

      case "search_knowledge": {
        searchKnowledgeCalled = true;
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
            }).catch((err) => logger.error({ err, query }, "Fehler beim Speichern der missed query"));
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
      case "search_dairycomp_manual": {
        const query = input.query as string;
        const topK = Math.min((input.topK as number | undefined) ?? 5, 10);
        const SIMILARITY_THRESHOLD = 0.35;
        const FALLBACK_THRESHOLD = 0.20;
        try {
          // ── Step 1: Keyword lookup in the structured Glossar (takes priority) ──
          // Split query into meaningful tokens (≥3 chars) and search the
          // Alltagsbegriff/Befehl lines with ILIKE. No embedding needed.
          const tokens = query
            .split(/\s+/)
            .map((t) => t.replace(/[%_\\]/g, "\\$&"))
            .filter((t) => t.length >= 3);
          type GlossarRow = { chunk_text: string };
          let glossarHits: GlossarRow[] = [];
          if (tokens.length > 0) {
            const likeFragments = tokens.map((t) => sql`kc.chunk_text ILIKE ${'%' + t + '%'}`);
            const likeCondition = sql.join(likeFragments, sql` OR `);
            const glossarResult = await db.execute(
              sql`
                SELECT kc.chunk_text
                FROM knowledge_chunks kc
                JOIN knowledge_documents kd ON kd.id = kc.doc_id
                WHERE kd.status = 'ready'
                  AND kd.document_type = 'dairycomp_glossar'
                  AND (${likeCondition})
                LIMIT 5
              `,
            );
            glossarHits = glossarResult.rows as GlossarRow[];
          }

          // ── Step 2: Semantic search in the manual ──
          const queryVec = await embedQuery(query);
          const vecStr = `[${queryVec.join(",")}]`;
          const manualResult = await db.execute(
            sql`
              SELECT kc.chunk_text, kd.title, kd.category,
                     (1 - (kc.embedding <=> ${vecStr}::vector)) AS similarity
              FROM knowledge_chunks kc
              JOIN knowledge_documents kd ON kd.id = kc.doc_id
              WHERE kd.status = 'ready'
                AND kd.document_type = 'dairycomp_manual'
              ORDER BY kc.embedding <=> ${vecStr}::vector
              LIMIT ${topK}
            `,
          );
          const allRows = manualResult.rows as { chunk_text: string; title: string; category: string | null; similarity: number }[];
          let relevantRows = allRows.filter((r) => Number(r.similarity) >= SIMILARITY_THRESHOLD);
          if (relevantRows.length < 2) {
            const fallbackRows = allRows.filter((r) => Number(r.similarity) >= FALLBACK_THRESHOLD);
            if (fallbackRows.length > relevantRows.length) relevantRows = fallbackRows;
          }

          // ── Step 3: Build combined result — Glossar entries first ──
          if (glossarHits.length === 0 && relevantRows.length === 0) {
            return {
              results: [],
              noRelevantResults: true,
              message: "Kein passender Eintrag im DairyComp-Handbuch gefunden. Bitte den DairyComp-Support kontaktieren.",
            };
          }

          const results: { title: string; text: string; similarity?: number; source?: string }[] = [];

          // Glossar hits first — exact match, highest priority
          for (const g of glossarHits) {
            results.push({ title: "DairyComp 305 Befehlsglossar", text: g.chunk_text, source: "glossar" });
          }
          // Manual semantic hits after
          for (const r of relevantRows) {
            results.push({ title: r.title, text: r.chunk_text, similarity: Number(r.similarity), source: "manual" });
          }

          citations.push({
            label: "DairyComp-Handbuch",
            value: "DairyComp-Dokumentation",
            basis: null,
            sourceType: "wissen",
          });
          opts.onSourceSearched?.(["DairyComp 305 Befehlsglossar", "DairyComp-Handbuch"].filter(
            (_, i) => i === 0 ? glossarHits.length > 0 : relevantRows.length > 0,
          ));
          return { results };
        } catch (err) {
          logger.error({ err }, "search_dairycomp_manual fehlgeschlagen");
          return { error: "DairyComp-Handbuch-Suche fehlgeschlagen" };
        }
      }
      case "search_farm_abbreviations": {
        const query = input.query as string;
        const topK = Math.min((input.topK as number | undefined) ?? 5, 10);
        const SIMILARITY_THRESHOLD = 0.25;
        try {
          // Exact-match pre-check: find chunks that literally contain the abbreviation code
          const exactRows = await db.execute(
            sql`
              SELECT kc.chunk_text, kd.title, kd.category
              FROM knowledge_chunks kc
              JOIN knowledge_documents kd ON kd.id = kc.doc_id
              WHERE kd.status = 'ready'
                AND kd.document_type = 'farm_abbreviations'
                AND UPPER(kc.chunk_text) LIKE UPPER(${`%${query}%`})
              LIMIT ${topK}
            `,
          );
          const exactMatches = exactRows.rows as { chunk_text: string; title: string; category: string | null }[];
          if (exactMatches.length > 0) {
            const seenTitles = new Set<string>();
            for (const r of exactMatches) {
              if (!seenTitles.has(r.title)) {
                seenTitles.add(r.title);
                citations.push({
                  label: "Betriebskürzel-Liste",
                  value: "Betriebsspezifische Abkürzungen",
                  basis: null,
                  sourceType: "wissen",
                });
                break;
              }
            }
            if (seenTitles.size > 0) opts.onSourceSearched?.(Array.from(seenTitles));
            return { results: exactMatches.map((r) => ({ title: r.title, text: r.chunk_text, similarity: 1.0 })) };
          }
          // Fallback: vector similarity search
          const queryVec = await embedQuery(query);
          const vecStr = `[${queryVec.join(",")}]`;
          const rows = await db.execute(
            sql`
              SELECT kc.chunk_text, kd.title, kd.category,
                     (1 - (kc.embedding <=> ${vecStr}::vector)) AS similarity
              FROM knowledge_chunks kc
              JOIN knowledge_documents kd ON kd.id = kc.doc_id
              WHERE kd.status = 'ready'
                AND kd.document_type = 'farm_abbreviations'
              ORDER BY kc.embedding <=> ${vecStr}::vector
              LIMIT ${topK}
            `,
          );
          const allRows = rows.rows as { chunk_text: string; title: string; category: string | null; similarity: number }[];
          const relevantRows = allRows.filter((r) => Number(r.similarity) >= SIMILARITY_THRESHOLD);
          if (relevantRows.length === 0) {
            return {
              results: [],
              noRelevantResults: true,
              message: "Kürzel nicht in Abkürzungsliste gefunden.",
            };
          }
          const seenTitles = new Set<string>();
          for (const r of relevantRows) {
            if (!seenTitles.has(r.title)) {
              seenTitles.add(r.title);
              citations.push({
                label: "Betriebskürzel-Liste",
                value: "Betriebsspezifische Abkürzungen",
                basis: null,
                sourceType: "wissen",
              });
              break;
            }
          }
          if (seenTitles.size > 0) opts.onSourceSearched?.(Array.from(seenTitles));
          return { results: relevantRows.map((r) => ({ title: r.title, text: r.chunk_text, similarity: Number(r.similarity) })) };
        } catch (err) {
          logger.error({ err }, "search_farm_abbreviations fehlgeschlagen");
          return { error: "Abkürzungssuche fehlgeschlagen" };
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
      case "show_heat_abatement_calculator": {
        widgetSpec = { type: "heat_abatement", prefill: input as Record<string, number> };
        return { acknowledged: true, widget: "heat_abatement" };
      }
      case "show_fresh_cow_calculator": {
        widgetSpec = { type: "fresh_cow", prefill: input as Record<string, number> };
        return { acknowledged: true, widget: "fresh_cow" };
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
          // KPI tiles: no series needed; accept 1–3 {label, value, unit} items
          if (chartType === "kpi") {
            if (!rawData || rawData.length < 1) {
              return { error: "Keine KPI-Daten übergeben (mind. 1 Eintrag benötigt)" };
            }
            const kpiChart: Chart = {
              id: `chart_${Math.random().toString(36).slice(2, 10)}`,
              type: "kpi",
              title,
              xKey: null,
              series: [],
              data: rawData.slice(0, 3),
              unit: null,
              basis: null,
            };
            charts.push(kpiChart);
            opts.onChart?.(kpiChart);
            return { ok: true, points: kpiChart.data.length, basis: "Investitionsrechnung" };
          }
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
      case "get_event_stats": {
        const rawEventType = input.event_type as string | string[] | undefined;
        if (!rawEventType) return { error: "event_type erforderlich" };
        const eventTypes = Array.isArray(rawEventType)
          ? rawEventType.map((t) => t.toUpperCase())
          : [rawEventType.toUpperCase()];
        const dateFrom = input.date_from as string | undefined;
        const dateTo = input.date_to as string | undefined;
        const groupBy = input.group_by as string | undefined;

        // Inline SQL literals — event type codes are controlled (uppercased enum values only)
        const typesIn = eventTypes.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");
        const dateFilterParts =
          `dataset_id = '${datasetId}'` +
          (dateFrom ? ` AND event_date >= '${dateFrom}'::date` : "") +
          (dateTo   ? ` AND event_date <= '${dateTo}'::date`   : "");

        let groupExpr: string;
        switch (groupBy) {
          case "month":      groupExpr = "TO_CHAR(event_date, 'YYYY-MM')"; break;
          case "quarter":    groupExpr = "TO_CHAR(event_date, 'YYYY-\"Q\"Q')"; break;
          case "year":       groupExpr = "EXTRACT(YEAR FROM event_date)::text"; break;
          case "remark":     groupExpr = "COALESCE(remark, '(kein)')"; break;
          case "result":     groupExpr = "COALESCE(result, '(kein)')"; break;
          case "technician": groupExpr = "COALESCE(technician, '(kein)')"; break;
          default:           groupExpr = "'total'"; break;
        }

        try {
          // Special case: BRED grouped by bull (remark) or technician →
          // include per-group conception rate by linking BRED→PREG via animal_id + date window.
          // German HMS systems store pregnancy confirmation as a separate PREG event, NOT as
          // result='P' on the BRED event itself.
          const isBredConceptionQuery =
            eventTypes.length === 1 &&
            eventTypes[0] === "BRED" &&
            (groupBy === "remark" || groupBy === "technician");

          if (isBredConceptionQuery) {
            const q = `
              WITH bred AS (
                SELECT ${groupExpr} as grp, animal_id, event_date
                FROM cow_events
                WHERE ${dateFilterParts} AND event_type = 'BRED'
              ),
              preg AS (
                SELECT DISTINCT animal_id, event_date as preg_date
                FROM cow_events
                WHERE dataset_id = '${datasetId}' AND event_type = 'PREG'
              ),
              bred_with_result AS (
                SELECT b.grp,
                       CASE WHEN EXISTS (
                         SELECT 1 FROM preg p
                         WHERE p.animal_id = b.animal_id
                           AND p.preg_date BETWEEN b.event_date AND b.event_date + INTERVAL '120 days'
                       ) THEN 1 ELSE 0 END as conceived
                FROM bred b
              )
              SELECT grp, COUNT(*)::int as cnt, SUM(conceived)::int as preg_count,
                     CASE WHEN COUNT(*) > 0
                          THEN ROUND(SUM(conceived)::numeric / COUNT(*) * 100, 1)
                          ELSE 0 END as conception_rate_pct
              FROM bred_with_result
              GROUP BY grp ORDER BY cnt DESC
            `;
            const res = await db.execute(sql.raw(q));
            const rows = res.rows as { grp: string; cnt: number; preg_count: number; conception_rate_pct: number }[];
            const totalBred = rows.reduce((s, r) => s + r.cnt, 0);
            const totalPreg = rows.reduce((s, r) => s + r.preg_count, 0);
            return {
              event_types: eventTypes,
              total: totalBred,
              group_by: groupBy,
              breakdown: rows.map((r) => ({
                [r.grp]: { bred: r.cnt, preg: r.preg_count, conception_rate_pct: Number(r.conception_rate_pct) },
              })),
              conception_rate_total_pct: totalBred > 0 ? Math.round((totalPreg / totalBred) * 1000) / 10 : null,
              date_from: dateFrom ?? null,
              date_to: dateTo ?? null,
              note: "Konzeptionsrate: PREG-Event innerhalb 120 Tage nach BRED für dasselbe Tier (animal_id)",
            };
          }

          // Standard count query — no dangling params, values are inlined
          const q = `SELECT ${groupExpr} as grp, COUNT(*)::int as cnt
                     FROM cow_events
                     WHERE ${dateFilterParts}
                       AND event_type IN (${typesIn})
                     GROUP BY 1 ORDER BY 1`;

          const result = await db.execute(sql.raw(q));
          const rows = result.rows as { grp: string; cnt: number }[];

          const totalCount = rows.reduce((s, r) => s + r.cnt, 0);
          const breakdown = rows.map((r) => ({ [r.grp]: r.cnt }));

          return {
            event_types: eventTypes,
            total: totalCount,
            group_by: groupBy ?? "total",
            breakdown,
            date_from: dateFrom ?? null,
            date_to: dateTo ?? null,
          };
        } catch (err) {
          logger.error({ err }, "get_event_stats fehlgeschlagen");
          return { error: "Berechnung fehlgeschlagen" };
        }
      }
      case "get_repro_kpis": {
        const dateFrom = input.date_from as string | undefined;
        const dateTo = input.date_to as string | undefined;

        const dateFilter =
          `dataset_id = '${datasetId}'` +
          (dateFrom ? ` AND event_date >= '${dateFrom}'::date` : "") +
          (dateTo   ? ` AND event_date <= '${dateTo}'::date`   : "");

        try {
          // Conception Rate via animal_id linking:
          // German HMS systems confirm pregnancy via a separate PREG event (TU positiv),
          // NOT via result='P' on the BRED event itself. We join each BRED event to any
          // PREG event for the same animal within 120 days to determine conception.
          const bredResult = await db.execute(sql.raw(`
            WITH bred AS (
              SELECT animal_id, event_date,
                     ROW_NUMBER() OVER (PARTITION BY animal_id ORDER BY event_date) as svc_num
              FROM cow_events
              WHERE ${dateFilter} AND event_type = 'BRED'
            ),
            preg AS (
              SELECT DISTINCT animal_id, event_date as preg_date
              FROM cow_events
              WHERE dataset_id = '${datasetId}' AND event_type = 'PREG'
            ),
            bred_with_result AS (
              SELECT b.animal_id, b.svc_num,
                     CASE WHEN EXISTS (
                       SELECT 1 FROM preg p
                       WHERE p.animal_id = b.animal_id
                         AND p.preg_date BETWEEN b.event_date AND b.event_date + INTERVAL '120 days'
                     ) THEN 1 ELSE 0 END as conceived
              FROM bred b
            ),
            totals AS (
              SELECT
                COUNT(*)::int as eligible,
                SUM(conceived)::int as pregnant,
                COUNT(*) FILTER (WHERE svc_num = 1)::int as first_svc_eligible,
                SUM(CASE WHEN svc_num = 1 THEN conceived ELSE 0 END)::int as first_svc_pregnant
              FROM bred_with_result
            )
            SELECT * FROM totals
          `));
          const bred = (bredResult.rows[0] ?? {}) as { eligible: number; pregnant: number; first_svc_eligible: number; first_svc_pregnant: number };

          // Services per Conception
          const totalBredResult = await db.execute(sql.raw(`
            SELECT COUNT(*)::int as total FROM cow_events WHERE ${dateFilter} AND event_type = 'BRED'
          `));
          const totalBred = (totalBredResult.rows[0] as { total: number } | undefined)?.total ?? 0;

          // Abortion Rate
          const abortResult = await db.execute(sql.raw(`
            SELECT COUNT(*)::int as cnt FROM cow_events WHERE ${dateFilter} AND event_type IN ('ABORT','ABORTION')
          `));
          const abortCount = (abortResult.rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

          // Culling Rate (distinct animals sold/died vs total distinct animals)
          const cullingResult = await db.execute(sql.raw(`
            SELECT
              COUNT(DISTINCT animal_id) FILTER (WHERE event_type IN ('SOLD','DIED')) as culled,
              COUNT(DISTINCT animal_id) as total_animals
            FROM cow_events WHERE ${dateFilter}
          `));
          const culling = (cullingResult.rows[0] ?? {}) as { culled: number; total_animals: number };

          const conceptionRate = bred.eligible > 0
            ? Math.round((bred.pregnant / bred.eligible) * 1000) / 10
            : null;
          const firstSvcConceptionRate = bred.first_svc_eligible > 0
            ? Math.round((bred.first_svc_pregnant / bred.first_svc_eligible) * 1000) / 10
            : null;
          const servicesPerConception = bred.pregnant > 0
            ? Math.round((totalBred / bred.pregnant) * 100) / 100
            : null;
          const cullingRate = culling.total_animals > 0
            ? Math.round((culling.culled / culling.total_animals) * 1000) / 10
            : null;
          const abortionRate = bred.pregnant > 0
            ? Math.round((abortCount / bred.pregnant) * 1000) / 10
            : null;

          return {
            conception_rate_pct: conceptionRate,
            conception_rate_basis: { numerator: bred.pregnant, denominator: bred.eligible },
            first_service_conception_rate_pct: firstSvcConceptionRate,
            first_service_basis: { numerator: bred.first_svc_pregnant, denominator: bred.first_svc_eligible },
            services_per_conception: servicesPerConception,
            services_per_conception_basis: { total_services: totalBred, conceptions: bred.pregnant },
            culling_rate_pct: cullingRate,
            culling_basis: { culled: culling.culled, total_animals: culling.total_animals },
            abortion_rate_pct: abortionRate,
            abortion_basis: { abortions: abortCount, confirmed_pregnancies: bred.pregnant },
            date_from: dateFrom ?? null,
            date_to: dateTo ?? null,
          };
        } catch (err) {
          logger.error({ err }, "get_repro_kpis fehlgeschlagen");
          return { error: "Berechnung fehlgeschlagen" };
        }
      }
      case "run_sql": {
        const rawQuery = (input.query as string | undefined)?.trim();
        if (!rawQuery) return { error: "Keine Abfrage angegeben" };

        // Layer 1: strip comments, require SELECT or WITH as first keyword
        const normalized = rawQuery
          .replace(/--[^\n]*/g, " ")
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .trim()
          .toLowerCase();
        const firstKeyword = normalized.split(/\s+/)[0];
        if (firstKeyword !== "select" && firstKeyword !== "with") {
          return { error: "Nur SELECT- oder WITH-Abfragen erlaubt. Schreiboperationen (INSERT, UPDATE, DELETE, DDL) sind nicht gestattet." };
        }

        // Layer 2: reject semicolons outside of string literals (multi-statement guard)
        if (containsSemicolonOutsideStrings(normalized)) {
          return { error: "Mehrere SQL-Anweisungen (Semikolon) sind nicht erlaubt." };
        }

        // Layer 3 (DB-enforced): inject DB-level LIMIT so the database never returns more than 500 rows.
        // For CTEs (WITH ...) append LIMIT; for plain SELECT wrap in outer query.
        const limitedQuery = buildLimitedQuery(rawQuery, 500);

        // Execute inside a transaction with the restricted milchvieh_analyst role.
        // SET LOCAL applies only within this transaction and is automatically reverted
        // on ROLLBACK — the role switch never leaks back to the connection pool.
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // Switch to restricted role: no access to users/analyses/messages/...
          await client.query("SET LOCAL ROLE milchvieh_analyst");
          // RLS policies on cow_events and data_rows enforce this dataset_id
          await client.query(
            `SET LOCAL app.current_dataset_id = '${datasetId.replace(/'/g, "''")}'`
          );
          // Hard DB-side timeout — query aborted after 10 s
          await client.query("SET LOCAL statement_timeout = '10000'");

          const result = await client.query(limitedQuery);
          const rows = result.rows as Record<string, unknown>[];
          const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
          const truncated = rows.length >= 500;
          return {
            columns,
            rows,
            row_count: rows.length,
            truncated,
            ...(truncated
              ? { note: "Ergebnis auf 500 Zeilen begrenzt — füge WHERE-Bedingungen hinzu für präzisere Ergebnisse." }
              : {}),
          };
        } catch (err) {
          logger.error({ err, query: rawQuery }, "run_sql fehlgeschlagen");
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `SQL-Fehler: ${msg.split("\n")[0]}` };
        } finally {
          // Always rollback — pure SELECT sandbox, rollback is safe and ensures
          // that SET LOCAL ROLE is fully undone before the connection returns to the pool.
          try { await client.query("ROLLBACK"); } catch (_) { /* ignore */ }
          client.release();
        }
      }
      case "signal_escalation": {
        const { trigger_type, reason } = input as { trigger_type?: string; reason?: string };
        return { ok: true, trigger_type: trigger_type ?? null, reason: reason ?? "" };
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
      case "search_farm_abbreviations": return "Durchsuche Betriebskürzel-Liste";
      case "search_dairycomp_manual": return "Durchsuche DairyComp-Handbuch";
      case "search_web": return "Durchsuche das Internet";
      case "calculate_investment": return "Berechne Investitionswirtschaftlichkeit";
      case "get_semen_planning": return "Lade gespeicherte Besamungsplanung";
      case "calculate_semen_planning": return "Berechne Besamungs- und Spermakosten";
      case "show_heat_abatement_calculator": return "Zeige Hitzestress-Rechner";
      case "show_fresh_cow_calculator": return "Zeige Frischmelker-ROI-Rechner";
      case "emit_chart": return `Erstelle Diagramm`;
      case "ask_farmer": return "Formuliere Rückfragen";
      case "get_event_stats": return `Berechne Event-Statistik${metric ? ` für ${metric}` : ""}`;
      case "get_repro_kpis": return "Berechne Fruchtbarkeitskennzahlen";
      case "run_sql": return `Führe SQL-Abfrage aus${input.description ? `: ${input.description as string}` : ""}`;
      default: return "Verarbeite Daten";
    }
  }

  function summarizeBetaToolInput(
    name: string,
    input: Record<string, unknown>,
    result: unknown,
  ): Record<string, unknown> {
    const r = result as Record<string, unknown> | null;
    switch (name) {
      case "run_sql":
        return {
          rowCount: Array.isArray((r as any)?.rows)
            ? (r as any).rows.length
            : ((r as any)?.rowCount ?? null),
        };
      case "get_kpis":
      case "get_metric_stats":
      case "get_timeseries":
      case "get_group_aggregate":
      case "get_animal_ranking":
      case "detect_anomalies":
      case "get_event_stats":
      case "get_repro_kpis":
        return { metric: input.metric ?? null };
      case "search_knowledge":
      case "search_farm_abbreviations":
      case "search_web":
        return { query: typeof input.query === "string" ? input.query.slice(0, 80) : null };
      case "emit_chart":
        return { chartType: input.chartType ?? null, metric: input.metric ?? null };
      case "signal_escalation":
        return {
          trigger_type: input.trigger_type ?? null,
          reason: String(input.reason ?? "").slice(0, 200),
        };
      default:
        return {};
    }
  }

  // Per-invocation cache: avoids redundant DB queries when emit_chart reuses
  // the same metric/groupBy/interval that was already fetched in the same turn.
  const turnResultCache = new Map<string, unknown>();

  let finalText = "";
  let toolWasCalled = false;
  let searchKnowledgeCalled = false;
  let firstTextDeltaFired = false;
  const backQuestions: FarmerQuestion[] = [];
  let widgetSpec: WidgetSpec | null = null;
  let capturedEscalation: { type: string; reason: string } | null = null;
  const betaToolLog: BetaToolEntry[] = [];
  const maxTurns = 20;

  // -------------------------------------------------------------------------
  // Model routing state — tracked per runAgent() invocation.
  // Seed askFarmerEverCalled from prior-round state so that when a user
  // replies to an ask_farmer back-question (new processQuestion call), the
  // very first turn of this invocation also escalates to Opus.
  // -------------------------------------------------------------------------
  let askFarmerEverCalled = opts.askFarmerCalledInPriorRound ?? false;
  const turnToolCounts: number[] = [];

  // Extract the current user question text (last user message in the conversation)
  // so we can classify follow-up turns and skip Opus for trivial replies.
  const lastUserMsg = [...opts.conversation].reverse().find((m) => m.role === "user");
  const lastUserText =
    typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : ((lastUserMsg?.content as Anthropic.ContentBlockParam[] | undefined) ?? [])
          .filter((b): b is Anthropic.TextBlockParam => b.type === "text")
          .map((b) => b.text)
          .join(" ");

  // Grounding: tools that prove real data was accessed
  const groundedTools = new Set([
    "get_schema",
    "get_metric_stats", "get_kpis", "get_timeseries",
    "get_group_aggregate", "get_animal_ranking", "detect_anomalies",
    "read_document",
    "search_knowledge",
    "search_farm_abbreviations",
    "search_dairycomp_manual",
    "calculate_investment",
    "get_semen_planning",
    "calculate_semen_planning",
    "ask_farmer",
    "get_event_stats",
    "get_repro_kpis",
    "run_sql",
    "get_master_data",
    "show_heat_abatement_calculator",
    "show_fresh_cow_calculator",
  ]);

  for (let turn = 0; turn < maxTurns; turn++) {
    // -------------------------------------------------------------------------
    // Per-turn model routing
    // -------------------------------------------------------------------------
    const recentToolCalls = turnToolCounts.slice(-2).reduce((s, c) => s + c, 0);
    // askFarmerCalledInPriorRound means the user has just answered a back-question
    // from the previous conversation message — this is already conversational Turn N+1,
    // so we allow escalation even on turn 0 of this runAgent() invocation.
    //
    // However, if ask_farmer is the ONLY escalation trigger (no heavy tool-call volume
    // and not explicitly in deep mode) and the follow-up question is classified as
    // trivial (single KPI, no complex signals), we skip Opus to avoid wasting cost on
    // simple replies like "yes", "ok", or a one-word answer.
    const askFarmerTriggered =
      (opts.askFarmerCalledInPriorRound === true && turn === 0) ||
      (turn > 0 && askFarmerEverCalled);
    const heavySignalTriggered = recentToolCalls > 6 || opts.depthLevel === "deep";
    const followUpIsSimple =
      askFarmerTriggered && !heavySignalTriggered && isTrivialFollowUp(lastUserText);
    const shouldEscalate = (askFarmerTriggered || heavySignalTriggered) && !followUpIsSimple;

    let turnTaskType: ModelTaskType = opts.initialTaskType ?? "chat_analysis";
    // Turn-0 Opus is only used when pre-routing already classified the question
    // as investment/stall-planning (chat_analysis_deep) — NOT for every deep-mode question.
    // depthLevel="deep" gates escalation on N+1 turns via shouldEscalate below.
    if (shouldEscalate) {
      turnTaskType = "chat_analysis_deep";
    }
    // "quick" mode: never escalate to Opus
    if (opts.depthLevel === "quick" && turnTaskType === "chat_analysis_deep") {
      turnTaskType = "chat_analysis";
    }

    const turnModel = getModelForTask(turnTaskType);
    const turnMaxTokens = turnTaskType === "chat_analysis_simple" ? 2048 : 8192;
    const turnTools = getToolsForTask(turnTaskType);

    // Use streaming so text tokens reach the client in real-time via onTextDelta.
    // callWithRetry wraps finalMessage(); 500/529 errors from Anthropic occur
    // before the first token arrives, so retries never emit duplicate deltas.
    const response = await callWithRetry(async () => {
      const stream = client.messages.stream({
        model: turnModel,
        max_tokens: turnMaxTokens,
        system: buildSystemBlocks(
          docContext,
          ((opts.systemExtra ?? "") + knowledgeTitles + abbrevBlock + datasetContext) || undefined,
        ),
        tools: turnTools,
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
      modelUsed: turnModel,
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
      // Track ask_farmer calls for Opus escalation on next turn
      if (toolUses.some((t) => t.name === "ask_farmer")) {
        askFarmerEverCalled = true;
      }
      // Track tool count per turn for >6-tool escalation heuristic
      turnToolCounts.push(toolUses.length);
      messages.push({ role: "assistant", content: response.content });
      const toolResults = [];
      for (const tu of toolUses) {
        const label = progressLabel(tu.name, (tu.input ?? {}) as Record<string, unknown>);
        await opts.onProgress?.(label);
        let result: unknown;
        const toolStartMs = Date.now();
        try {
          result = await execTool(tu);
        } catch (err) {
          logger.error({ err, tool: tu.name }, "Werkzeugausführung fehlgeschlagen");
          result = { error: "Berechnung fehlgeschlagen" };
        }
        const toolDurationMs = Date.now() - toolStartMs;

        // Capture escalation trigger from signal_escalation tool call
        if (tu.name === "signal_escalation" && result && typeof result === "object") {
          const r = result as Record<string, unknown>;
          if (r.trigger_type && !capturedEscalation) {
            capturedEscalation = { type: String(r.trigger_type), reason: String(r.reason ?? "") };
          }
        }

        // Collect structured tool call entry for beta analytics
        if (opts.isBeta) {
          betaToolLog.push({
            toolName: tu.name,
            keyParams: summarizeBetaToolInput(tu.name, (tu.input ?? {}) as Record<string, unknown>, result),
            durationMs: toolDurationMs,
            escalationTrigger: tu.name === "signal_escalation" ? (capturedEscalation?.type ?? null) : null,
            escalationReason: tu.name === "signal_escalation" ? (capturedEscalation?.reason ?? null) : null,
          });
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

  // Post-agent fallback: if the agent produced a real answer but never called
  // search_knowledge (despite the mandatory instruction), record the original
  // user question as a missed query with topScore=null so the knowledge-gaps
  // panel is populated even when the agent skips the step.
  if (!searchKnowledgeCalled && finalText && knowledgeDocsExist) {
    const lastUserMsg = [...opts.conversation].reverse().find((m) => m.role === "user");
    const userQuery = typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content.trim()
      : "";
    if (userQuery) {
      logger.debug({ query: userQuery }, "search_knowledge nie aufgerufen — trage missed query ein");
      db.insert(knowledgeMissedQueriesTable).values({
        query: userQuery,
        topScore: null,
        customerId: opts.userId ?? null,
      }).catch((err) => logger.error({ err, query: userQuery }, "Fehler beim Speichern der missed query (Fallback)"));
    }
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
      "Für diese Frage wurden allgemeine Richtwerte verwendet — mit Ihren hochgeladenen Betriebsdaten " +
      "(Milchleistung, Herdendaten, Ereignisprotokoll) kann die Analyse gezielt auf Ihren Betrieb " +
      "zugeschnitten werden und liefert deutlich präzisere Ergebnisse.";
    return { text: finalText, charts, citations, backQuestions, widgetSpec, toolLog: betaToolLog, escalationTrigger: capturedEscalation };
  }

  return { text: finalText, charts, citations, backQuestions, widgetSpec, toolLog: betaToolLog, escalationTrigger: capturedEscalation };
}

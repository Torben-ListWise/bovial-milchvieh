import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessageParam,
  BetaTool,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  masterDataTable,
  sourceFilesTable,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
} from "@workspace/db";
import { embedTexts } from "./embeddings";
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
}
export interface AgentResult {
  text: string;
  charts: Chart[];
  citations: Citation[];
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

const TOOLS: BetaTool[] = [
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
    cache_control: { type: "ephemeral" },
  },
];

const SYSTEM_PROMPT = `Du bist ein vertrauenswürdiger Datenanalyse-Assistent für Milchviehbetriebe. Du antwortest ausschließlich auf Deutsch in klarer, fachlich korrekter Sprache für Landwirtinnen und Landwirte.

STRIKTE REGELN:
- Alle Zahlen stammen AUSSCHLIESSLICH aus den Werkzeug-Ergebnissen oder dem extrahierten Dokumenttext. Erfinde NIEMALS Zahlen, Mittelwerte oder Trends.
- Wenn du eine Zahl nennst, muss sie aus einem Werkzeug oder einem Dokumenttext stammen.
- Beginne immer mit get_schema, um zu wissen, welche Felder verfügbar sind.
- Wenn ein Wert nicht berechnet werden kann oder Daten fehlen, sage das ehrlich.
- Nutze emit_chart, um zentrale Aussagen mit einem passenden Diagramm zu untermauern (meist 1–3 Diagramme). Bei strukturierten DB-Daten: source='timeseries'|'group'|'ranking'. Bei PDF-Dokumenten: source='document' mit manuell konstruiertem data-Array.
- Vergleiche Werte bei Bedarf mit den geprüften Stammdaten (get_master_data), falls vorhanden.
- Fasse am Ende die wichtigsten Erkenntnisse verständlich zusammen. Nenne konkrete Zahlen mit Einheiten.
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
- Stell NICHT in Frage, ob die Zahlen aus der vorherigen Antwort korrekt waren — sie sind korrekt belegt (aus dem Dokument).`;

interface RunOptions {
  datasetId: string;
  conversation: { role: "user" | "assistant"; content: string }[];
  systemExtra?: string;
  onProgress?: (step: string | null) => Promise<void>;
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

export async function runAgent(opts: RunOptions): Promise<AgentResult> {
  const client = getClient();
  const charts: Chart[] = [];
  const citations: Citation[] = [];
  const { datasetId } = opts;

  const messages: BetaMessageParam[] = opts.conversation.map((m) => ({
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

  function buildSystemBlocks(docCtx: string, extra?: string) {
    return [
      { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
      docCtx ? { type: "text" as const, text: docCtx, cache_control: { type: "ephemeral" as const } } : null,
      extra ? { type: "text" as const, text: extra } : null,
    ].filter((b): b is NonNullable<typeof b> => b !== null);
  }

  async function execTool(block: BetaToolUseBlock): Promise<unknown> {
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
          });
        }
        return stats ?? { error: "Keine Daten für diese Kennzahl" };
      }
      case "get_timeseries":
        return (
          (await computeTimeseries(
            datasetId,
            metric!,
            (input.interval as "day" | "week" | "month") ?? "month",
            (input.aggregation as "avg" | "sum") ?? "avg",
          )) ?? { error: "Keine Daten" }
        );
      case "get_group_aggregate":
        return (
          (await computeGroupAggregate(
            datasetId,
            metric!,
            input.groupBy as string,
            (input.aggregation as "avg" | "sum" | "count") ?? "avg",
          )) ?? { error: "Keine Daten" }
        );
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
        const rows = cat
          ? await db
              .select()
              .from(masterDataTable)
              .where(eq(masterDataTable.category, cat))
          : await db.select().from(masterDataTable);
        return rows;
      }
      case "read_document": {
        if (!docContext) return { text: "Keine Dokumente vorhanden." };
        // Strip the header prefix — return only the raw document text
        const rawText = docContext
          .replace(/^\n\nHOCHGELADENE DOKUMENTE.*?:\n/s, "")
          .trim();
        return { text: rawText };
      }
      case "search_knowledge": {
        const query = input.query as string;
        const topK = Math.min((input.topK as number | undefined) ?? 5, 10);
        try {
          const [queryVec] = await embedTexts([query]);
          const vecStr = `[${queryVec.join(",")}]`;
          const rows = await db.execute(
            sql`
              SELECT kc.chunk_text, kd.title
              FROM knowledge_chunks kc
              JOIN knowledge_documents kd ON kd.id = kc.doc_id
              WHERE kd.status = 'ready'
              ORDER BY kc.embedding <=> ${vecStr}::vector
              LIMIT ${topK}
            `,
          );
          const results = (rows.rows as { chunk_text: string; title: string }[]).map(
            (r) => ({ title: r.title, text: r.chunk_text }),
          );
          return { results };
        } catch (err) {
          logger.error({ err }, "search_knowledge fehlgeschlagen");
          return { error: "Suche fehlgeschlagen" };
        }
      }
      case "emit_chart": {
        const title = (input.title as string) ?? "Diagramm";
        const chartType = (input.chartType as Chart["type"]) ?? "bar";
        const source = input.source as string;
        if (source === "timeseries") {
          const ts = await computeTimeseries(
            datasetId,
            metric!,
            (input.interval as "day" | "week" | "month") ?? "month",
            (input.aggregation as "avg" | "sum") ?? "avg",
          );
          if (!ts) return { error: "Keine Daten für Diagramm" };
          const chart = chartFromTimeseries(ts, title, chartType);
          charts.push(chart);
          return { ok: true, points: ts.points.length, basis: basisText(ts.basis) };
        }
        if (source === "group") {
          const g = await computeGroupAggregate(
            datasetId,
            metric!,
            input.groupBy as string,
            (input.aggregation as "avg" | "sum" | "count") ?? "avg",
          );
          if (!g) return { error: "Keine Daten für Diagramm" };
          const chart = chartFromGroup(g, title, chartType);
          charts.push(chart);
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
          charts.push({
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
          });
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
          charts.push({
            id: `chart_${Math.random().toString(36).slice(2, 10)}`,
            type: chartType,
            title,
            xKey,
            series: seriesInput,
            data: rawData,
            unit: (input.unit as string) ?? null,
            basis: "Dokument",
          });
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
      case "emit_chart": return `Erstelle Diagramm`;
      default: return "Verarbeite Daten";
    }
  }

  let finalText = "";
  let toolWasCalled = false;
  const maxTurns = 20;

  // Grounding: tools that prove real data was accessed
  const groundedTools = new Set([
    "get_schema",
    "get_metric_stats", "get_kpis", "get_timeseries",
    "get_group_aggregate", "get_animal_ranking", "detect_anomalies",
    "read_document",
    "search_knowledge",
  ]);

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: buildSystemBlocks(
        docContext,
        ((opts.systemExtra ?? "") + knowledgeTitles) || undefined,
      ),
      tools: TOOLS,
      // Force at least one tool call on the first turn so the agent always
      // grounds its response in actual data (prevents hallucination on turn 0).
      tool_choice: turn === 0 ? { type: "any" } : { type: "auto" },
      messages,
    });
    logger.debug({
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      input_tokens: response.usage.input_tokens,
    }, "Anthropic usage");

    const textParts = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text);
    if (textParts.length) finalText = textParts.join("\n").trim();

    if (response.stop_reason === "tool_use") {
      const toolUses = response.content.filter(
        (b): b is BetaToolUseBlock => b.type === "tool_use",
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
  if (!toolWasCalled && finalText) {
    logger.warn(
      { datasetId: opts.datasetId },
      "Agent antwortete ohne Werkzeugaufruf — Antwort wird verworfen (Grounding-Garantie)",
    );
    finalText =
      "Die Analyse konnte nicht auf Basis Ihrer Daten durchgeführt werden. " +
      "Bitte stellen Sie sicher, dass der Datensatz korrekt hochgeladen und verarbeitet wurde.";
    return { text: finalText, charts, citations };
  }

  // Self-verification: agent checks its own numbers against tool results.
  // This runs inside runAgent where the full messages array (including all
  // tool_use / tool_result blocks) is still in memory.
  if (finalText) {
    await opts.onProgress?.("Überprüfe Ergebnisse");
    const verifyMessages = [
      ...messages,
      {
        role: "user" as const,
        content:
          "Überprüfungsschritt: Stimmen alle genannten Zahlen exakt mit den " +
          "Tool-Ergebnissen oder dem Dokumenttext überein? " +
          "Antworte NUR mit der fertigen Antwort — kein Kommentar zur Überprüfung, " +
          "keine Erklärung des Prozesses, kein 'Problem:' oder 'Korrigierte Antwort:'. " +
          "Gib ausschließlich den Text zurück, den der Landwirt lesen soll.",
      },
    ];
    try {
      // Do NOT pass tools — verification is a pure text review.
      // Include docContext so the verifier can see PDF content and won't
      // incorrectly flag document-sourced numbers as ungrounded.
      const verifyResponse = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: buildSystemBlocks(docContext, ((opts.systemExtra ?? "") + knowledgeTitles) || undefined),
        messages: verifyMessages,
      });
      logger.debug({
        cache_creation_input_tokens: verifyResponse.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: verifyResponse.usage.cache_read_input_tokens ?? 0,
        input_tokens: verifyResponse.usage.input_tokens,
      }, "Anthropic usage (verify)");
      const verifiedText = verifyResponse.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (verifiedText) finalText = verifiedText;
    } catch (err) {
      logger.warn({ err }, "Verification-Schritt fehlgeschlagen — Originalantwort wird verwendet");
    }
  }

  return { text: finalText, charts, citations };
}

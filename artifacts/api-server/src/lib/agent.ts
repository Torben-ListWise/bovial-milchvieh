import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { and, eq } from "drizzle-orm";
import { db, masterDataTable } from "@workspace/db";
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
    name: "emit_chart",
    description:
      "Erstellt ein interaktives Diagramm aus deterministisch berechneten Daten und hängt es an die Antwort an. Die Daten werden serverseitig berechnet.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        chartType: { type: "string", enum: ["line", "bar", "area", "pie"] },
        source: { type: "string", enum: ["timeseries", "group", "ranking"] },
        metric: { type: "string" },
        interval: { type: "string", enum: ["day", "week", "month"] },
        aggregation: { type: "string", enum: ["avg", "sum", "count"] },
        groupBy: { type: "string" },
        order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number" },
      },
      required: ["title", "chartType", "source", "metric"],
    },
  },
];

const SYSTEM_PROMPT = `Du bist ein vertrauenswürdiger Datenanalyse-Assistent für Milchviehbetriebe. Du antwortest ausschließlich auf Deutsch in klarer, fachlich korrekter Sprache für Landwirtinnen und Landwirte.

STRIKTE REGELN:
- Alle Zahlen stammen AUSSCHLIESSLICH aus den Werkzeug-Ergebnissen. Erfinde NIEMALS Zahlen, Mittelwerte oder Trends.
- Wenn du eine Zahl nennst, muss sie zuvor von einem Werkzeug berechnet worden sein.
- Beginne immer mit get_schema, um zu wissen, welche Felder verfügbar sind. Verwende nur vorhandene Felder.
- Wenn ein Wert nicht berechnet werden kann oder Daten fehlen, sage das ehrlich.
- Nutze emit_chart, um zentrale Aussagen mit einem passenden Diagramm zu untermauern (meist 1–3 Diagramme).
- Vergleiche Werte bei Bedarf mit den geprüften Stammdaten (get_master_data), falls vorhanden.
- Fasse am Ende die wichtigsten Erkenntnisse verständlich zusammen. Nenne konkrete Zahlen mit Einheiten.
- Sei präzise und vermeide Spekulation. Lieber weniger, aber belastbare Aussagen.`;

interface RunOptions {
  datasetId: string;
  conversation: { role: "user" | "assistant"; content: string }[];
  systemExtra?: string;
  onProgress?: (step: string | null) => Promise<void>;
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

  async function execTool(block: ToolUseBlock): Promise<unknown> {
    const input = (block.input ?? {}) as Record<string, unknown>;
    const metric = input.metric as string | undefined;
    switch (block.name) {
      case "get_schema":
        return getDatasetSchema(datasetId);
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
  ]);

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: opts.systemExtra
        ? `${SYSTEM_PROMPT}\n\n${opts.systemExtra}`
        : SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    const textParts = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text);
    if (textParts.length) finalText = textParts.join("\n").trim();

    if (response.stop_reason === "tool_use") {
      const toolUses = response.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.some((t) => groundedTools.has(t.name))) {
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
          "Überprüfungsschritt: Kontrolliere deine Antwort. Stimmen alle genannten " +
          "Zahlen exakt mit den oben stehenden Tool-Ergebnissen überein? " +
          "Falls ja, gib die Antwort unverändert zurück. " +
          "Falls nein, korrigiere ausschließlich die fehlerhaften Stellen und " +
          "gib die vollständige korrigierte Antwort zurück.",
      },
    ];
    try {
      // Do NOT pass tools — verification is a pure text review.
      const verifyResponse = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: opts.systemExtra
          ? `${SYSTEM_PROMPT}\n\n${opts.systemExtra}`
          : SYSTEM_PROMPT,
        messages: verifyMessages,
      });
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

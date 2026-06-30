import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  datasetsTable,
  reportsTable,
  activityLogTable,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
  masterDataTable,
  type Report,
} from "@workspace/db";
import {
  ListReportsParams,
  ListReportsResponse,
  GenerateReportParams,
  GenerateReportBody,
  GetReportParams,
  GetReportResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { computeDashboard } from "../lib/compute";
import { runAgent } from "../lib/agent";
import { logger } from "../lib/logger";
import { generateInsightsSummary } from "../lib/insightsSummary";
import Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

const PERIOD_LABEL: Record<string, string> = {
  weekly: "Wochen",
  monthly: "Monats",
  quarterly: "Quartals",
  custom: "individuellen",
};

interface KpiRow {
  label: string;
  valueStr: string;
  caseType: 1 | 2 | 3;
  standDate?: string;
}

function serializeReport(r: Report) {
  return {
    id: r.id,
    datasetId: r.datasetId,
    title: r.title,
    period: r.period as "weekly" | "monthly" | "quarterly" | "custom",
    summary: r.summary ?? null,
    sections: (r.sections as unknown[] | null) ?? [],
    status: r.status as "generating" | "ready" | "error",
    createdAt: r.createdAt,
  };
}

async function ownDataset(datasetId: string, userId: string): Promise<boolean> {
  const [d] = await db
    .select({ id: datasetsTable.id })
    .from(datasetsTable)
    .where(and(eq(datasetsTable.id, datasetId), eq(datasetsTable.userId, userId)));
  return !!d;
}

router.get(
  "/datasets/:datasetId/reports",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = ListReportsParams.parse(req.params);
    if (!(await ownDataset(datasetId, req.userId!))) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }
    const rows = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.datasetId, datasetId))
      .orderBy(desc(reportsTable.createdAt));
    res.json(ListReportsResponse.parse(rows.map(serializeReport)));
  },
);

router.post(
  "/datasets/:datasetId/reports",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = GenerateReportParams.parse(req.params);
    const parsed = GenerateReportBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ungültige Eingabe" });
      return;
    }
    if (!(await ownDataset(datasetId, req.userId!))) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }

    const period = parsed.data.period;
    const title =
      parsed.data.title?.trim() ||
      `${PERIOD_LABEL[period] ?? ""}bericht ${new Date().toLocaleDateString("de-DE")}`;

    const { kpis, charts } = await computeDashboard(datasetId);

    // ── Benchmark reference logic ────────────────────────────────────────────
    const [benchmarkDoc] = await db
      .select()
      .from(knowledgeDocumentsTable)
      .where(
        and(
          eq(knowledgeDocumentsTable.documentType, "benchmark_reference"),
          eq(knowledgeDocumentsTable.status, "ready"),
        ),
      )
      .limit(1);

    let benchmarkValues: Record<string, number | null> = {};
    let benchmarkDateStr: string | null = null;

    if (benchmarkDoc) {
      benchmarkDateStr = new Date(benchmarkDoc.createdAt).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      const chunks = await db
        .select({ chunkText: knowledgeChunksTable.chunkText })
        .from(knowledgeChunksTable)
        .where(eq(knowledgeChunksTable.docId, benchmarkDoc.id))
        .orderBy(asc(knowledgeChunksTable.chunkIndex));

      const fullText = chunks.map((c) => c.chunkText).join("\n");
      const apiKey = process.env.ANTHROPIC_API_KEY;

      if (apiKey && fullText.trim()) {
        try {
          const client = new Anthropic({ apiKey });
          const extraction = await client.messages.create({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 512,
            messages: [
              {
                role: "user",
                content: `Extrahiere aus dem folgenden Benchmark-Dokument numerische Richtwerte für die genannten Kennzahlen. Antworte ausschließlich mit einem JSON-Objekt, kein weiterer Text.

Kennzahlen (JSON-Schlüssel → Beschreibung und typischer Wertebereich):
- milk_yield_kg → Milchleistung in kg pro Jahr (typisch 7000–12000)
- fat_pct → Fettgehalt in % (typisch 3.5–5.0)
- protein_pct → Eiweißgehalt in % (typisch 3.0–4.0)
- scc → Somatische Zellzahl in Tausend/ml (typisch 100–300)
- urea → Harnstoff in mg/dl (typisch 150–300)
- feed_intake_kg → Futteraufnahme in kg pro Tag (typisch 20–30)

Dokument:
${fullText.slice(0, 6000)}

Antworte mit genau diesem JSON (null wenn Wert nicht im Dokument enthalten):
{"milk_yield_kg":null,"fat_pct":null,"protein_pct":null,"scc":null,"urea":null,"feed_intake_kg":null}`,
              },
            ],
          });
          const raw = (
            (extraction.content[0] as { type: string; text: string }).text ?? ""
          ).trim();
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) {
            const extracted = JSON.parse(match[0]) as Record<string, unknown>;
            for (const [k, v] of Object.entries(extracted)) {
              benchmarkValues[k] = typeof v === "number" ? v : null;
            }
          }
        } catch (err) {
          logger.warn({ err }, "Benchmark-Wertextraktion fehlgeschlagen");
        }
      }
    }

    // Load configurable benchmark deviation factor from master_data
    const [factorRow] = await db
      .select({ value: masterDataTable.value })
      .from(masterDataTable)
      .where(
        and(
          eq(masterDataTable.category, "Systemeinstellungen"),
          eq(masterDataTable.key, "benchmark_abweichungsfaktor"),
        ),
      )
      .limit(1);
    const benchmarkFactor = factorRow ? parseFloat(factorRow.value) || 5 : 5;

    // ── 3-case KPI annotation logic ──────────────────────────────────────────
    const kpiRows: KpiRow[] = [];
    const kpiLines: string[] = [];

    for (const k of kpis) {
      const benchRef = benchmarkValues[k.key] ?? null;
      const hasValue = k.value !== null && k.value !== undefined;
      const numVal = hasValue ? (k.value as number) : null;

      const formatVal = (v: number) => `${v}${k.unit ? " " + k.unit : ""}`;
      const deltaStr =
        k.deltaPct != null ? ` (${k.deltaPct > 0 ? "+" : ""}${k.deltaPct}%)` : "";

      if (!hasValue) {
        // Case 2: value missing → fill from benchmark reference
        if (benchRef !== null) {
          const refStr = formatVal(benchRef);
          const standLabel = benchmarkDateStr
            ? `Branchenrichtwert, Stand: ${benchmarkDateStr}`
            : "Branchenrichtwert";
          kpiLines.push(`${k.label}: ${refStr} (${standLabel})`);
          kpiRows.push({
            label: k.label,
            valueStr: refStr,
            caseType: 2,
            standDate: benchmarkDateStr ?? undefined,
          });
        } else {
          kpiLines.push(`${k.label}: —`);
          kpiRows.push({ label: k.label, valueStr: "—", caseType: 1 });
        }
      } else if (benchRef !== null && benchRef > 0 && numVal! > 0) {
        // Compare own value against benchmark using max/min ratio
        const ratio = Math.max(numVal!, benchRef) / Math.min(numVal!, benchRef);
        if (ratio > benchmarkFactor) {
          // Case 3: unusual deviation — keep own value, add inline warning
          const valStr = `${formatVal(numVal!)}${deltaStr}`;
          kpiLines.push(
            `${k.label}: ${valStr} [ungewöhnliche Abweichung vom Richtwert, möglicher Erfassungsfehler, bitte Originaldaten prüfen]`,
          );
          kpiRows.push({ label: k.label, valueStr: valStr, caseType: 3 });
        } else {
          // Case 1: own value within expected range
          const valStr = `${formatVal(numVal!)}${deltaStr}`;
          kpiLines.push(`${k.label}: ${valStr}`);
          kpiRows.push({ label: k.label, valueStr: valStr, caseType: 1 });
        }
      } else {
        // Case 1: no benchmark reference available for comparison
        const valStr = `${formatVal(numVal!)}${deltaStr}`;
        kpiLines.push(`${k.label}: ${valStr}`);
        kpiRows.push({ label: k.label, valueStr: valStr, caseType: 1 });
      }
    }

    // ── Agent-generated narrative summary ────────────────────────────────────
    let summary: string | null = null;
    try {
      const result = await runAgent({
        datasetId,
        conversation: [
          {
            role: "user",
            content: `Erstelle eine sachliche Zusammenfassung der wichtigsten Kennzahlen und Auffälligkeiten dieses Milchviehbetriebs für einen ${PERIOD_LABEL[period] ?? ""}bericht.`,
          },
        ],
        systemExtra:
          "Antworte mit 3 bis 6 Sätzen Fließtext ohne Diagramme. Nenne konkrete Zahlen aus den Werkzeugen.",
      });
      summary = result.text || null;
    } catch {
      summary = null;
    }

    const sections = [
      {
        title: "Kennzahlen im Überblick",
        content: kpiLines.join("\n") || "Keine berechenbaren Kennzahlen vorhanden.",
        charts,
        kpiRows,
      },
    ];

    const [created] = await db
      .insert(reportsTable)
      .values({
        datasetId,
        userId: req.userId!,
        title,
        period,
        summary,
        sections,
        status: "ready",
      })
      .returning();

    await db.insert(activityLogTable).values({
      userId: req.userId!,
      type: "report",
      category: period,
      datasetRef: datasetId.slice(0, 8),
    });

    generateInsightsSummary(datasetId).catch((err) =>
      logger.warn({ err, datasetId }, "InsightsSummary-Generierung fehlgeschlagen — wird übersprungen"),
    );

    res.status(201).json(serializeReport(created));
  },
);

router.get("/reports/:reportId", requireAuth, async (req: Request, res: Response) => {
  const { reportId } = GetReportParams.parse(req.params);
  const [r] = await db
    .select()
    .from(reportsTable)
    .where(and(eq(reportsTable.id, reportId), eq(reportsTable.userId, req.userId!)));
  if (!r) {
    res.status(404).json({ error: "Bericht nicht gefunden" });
    return;
  }
  res.json(GetReportResponse.parse(serializeReport(r)));
});

// PDF export: renders annotated HTML the browser can print-to-PDF.
router.get(
  "/reports/:reportId/pdf",
  requireAuth,
  async (req: Request, res: Response) => {
    const { reportId } = GetReportParams.parse(req.params);
    const [r] = await db
      .select()
      .from(reportsTable)
      .where(and(eq(reportsTable.id, reportId), eq(reportsTable.userId, req.userId!)));
    if (!r) {
      res.status(404).json({ error: "Bericht nicht gefunden" });
      return;
    }

    const sections = (
      r.sections as Array<{
        title?: string;
        content?: string;
        kpiRows?: KpiRow[];
      }> | null
    ) ?? [];

    const sectionHtml = sections
      .map((s) => {
        let contentHtml: string;
        const rows = s.kpiRows;

        if (rows && rows.length > 0) {
          const tableRows = rows
            .map((row) => {
              if (row.caseType === 2) {
                const standLabel = row.standDate
                  ? `Branchenrichtwert, Stand: ${row.standDate}`
                  : "Branchenrichtwert";
                return `<tr>
                  <td style="padding:5px 14px 5px 0;font-weight:600;white-space:nowrap;vertical-align:top">${row.label}</td>
                  <td style="padding:5px 14px 5px 0;white-space:nowrap;vertical-align:top">${row.valueStr}</td>
                  <td style="padding:5px 0;color:#92400e;font-size:.82rem;font-style:italic;vertical-align:top">${standLabel}</td>
                </tr>`;
              }
              if (row.caseType === 3) {
                return `<tr>
                  <td style="padding:5px 14px 5px 0;font-weight:600;white-space:nowrap;vertical-align:top">${row.label}</td>
                  <td style="padding:5px 14px 5px 0;white-space:nowrap;vertical-align:top">${row.valueStr}</td>
                  <td style="padding:5px 0;color:#b45309;font-size:.82rem;vertical-align:top">&#9888; ungewöhnliche Abweichung vom Richtwert — möglicher Erfassungsfehler, bitte Originaldaten prüfen</td>
                </tr>`;
              }
              return `<tr>
                <td style="padding:5px 14px 5px 0;font-weight:600;white-space:nowrap;vertical-align:top">${row.label}</td>
                <td style="padding:5px 0;vertical-align:top" colspan="2">${row.valueStr}</td>
              </tr>`;
            })
            .join("");
          contentHtml = `<table style="border-collapse:collapse;width:100%;font-size:.95rem">${tableRows}</table>`;
        } else {
          contentHtml = `<pre style="white-space:pre-wrap;font-family:inherit">${s.content ?? ""}</pre>`;
        }

        return `<section><h2>${s.title ?? ""}</h2>${contentHtml}</section>`;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <title>${r.title}</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#1a1a1a}
    h1{font-size:1.6rem;margin-bottom:4px}
    .meta{color:#666;font-size:.85rem;margin-bottom:32px}
    h2{font-size:1.1rem;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px}
    p{line-height:1.6}
    table td{vertical-align:top}
    @media print{body{margin:0}}
  </style>
</head>
<body>
  <h1>${r.title}</h1>
  <p class="meta">Erstellt: ${new Date(r.createdAt).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" })} · ${r.period}</p>
  ${r.summary ? `<p>${r.summary}</p>` : ""}
  ${sectionHtml}
</body>
</html>`;

    const filename = `bericht-${reportId.slice(0, 8)}.html`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(html);
    logger.info({ reportId }, "Bericht-PDF-Export (HTML) ausgeliefert");
  },
);

router.get(
  "/datasets/:datasetId/insights-summary",
  requireAuth,
  async (req: Request, res: Response) => {
    const datasetId = req.params.datasetId as string;
    if (!(await ownDataset(datasetId, req.userId!))) {
      res.status(404).json({ error: "Nicht gefunden" });
      return;
    }
    const [row] = await db
      .select({ insightsSummary: datasetsTable.insightsSummary })
      .from(datasetsTable)
      .where(eq(datasetsTable.id, datasetId));
    res.json(row?.insightsSummary ?? null);
  },
);

export default router;

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  datasetsTable,
  reportsTable,
  activityLogTable,
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

const router: IRouter = Router();

const PERIOD_LABEL: Record<string, string> = {
  weekly: "Wochen",
  monthly: "Monats",
  quarterly: "Quartals",
  custom: "individuellen",
};

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

    const kpiLines = kpis
      .map(
        (k) =>
          `${k.label}: ${k.value ?? "—"}${k.unit ? " " + k.unit : ""}${
            k.deltaPct != null ? ` (${k.deltaPct > 0 ? "+" : ""}${k.deltaPct}%)` : ""
          }`,
      )
      .join("\n");

    const sections = [
      {
        title: "Kennzahlen im Überblick",
        content: kpiLines || "Keine berechenbaren Kennzahlen vorhanden.",
        charts,
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

// PDF export: renders a plain-text HTML page the browser can print-to-PDF.
// A full headless-PDF library (Puppeteer, pdfkit) is not bundled to keep the
// container small; instead we emit print-ready HTML with a Content-Disposition
// header. The client receives it as a downloadable file.
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

    const sections = (r.sections as Array<{ title?: string; content?: string }> | null) ?? [];
    const sectionHtml = sections
      .map(
        (s) =>
          `<section><h2>${s.title ?? ""}</h2><pre style="white-space:pre-wrap;font-family:inherit">${s.content ?? ""}</pre></section>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <title>${r.title}</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;color:#1a1a1a}
    h1{font-size:1.6rem;margin-bottom:4px}
    .meta{color:#666;font-size:.85rem;margin-bottom:32px}
    h2{font-size:1.1rem;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px}
    p{line-height:1.6}
    @media print{body{margin:0}}
  </style>
</head>
<body>
  <h1>${r.title}</h1>
  <p class="meta">Erstellt: ${new Date(r.createdAt).toLocaleDateString("de-DE", { day:"2-digit", month:"long", year:"numeric" })} · ${r.period}</p>
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

export default router;

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

export default router;

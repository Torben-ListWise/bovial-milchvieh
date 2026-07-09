import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  datasetsTable,
  sourceFilesTable,
  dataRowsTable,
  warningsTable,
  contextFactsTable,
  analysesTable,
  messagesTable,
  reportsTable,
  activityLogTable,
  type Dataset,
} from "@workspace/db";
import {
  ListDatasetsResponse,
  CreateDatasetBody,
  GetDatasetParams,
  GetDatasetResponse,
  UpdateDatasetParams,
  UpdateDatasetBody,
  UpdateDatasetResponse,
  DeleteDatasetParams,
  GetDatasetOverviewParams,
  GetDatasetOverviewResponse,
  GetQuestionSuggestionsParams,
  GetQuestionSuggestionsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { serializeDataset, mapDatasetStatus, normalizeSector } from "../lib/serializers";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import { computeDashboard, getDatasetSchema } from "../lib/compute";
import { canReadDataset, getActiveHostIds } from "../lib/teamAccess";

const router: IRouter = Router();

async function counts(datasetId: string) {
  const [f] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(sourceFilesTable)
    .where(eq(sourceFilesTable.datasetId, datasetId));
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(dataRowsTable)
    .where(eq(dataRowsTable.datasetId, datasetId));
  return { fileCount: f?.c ?? 0, rowCount: r?.c ?? 0 };
}

async function ownDataset(
  datasetId: string,
  userId: string,
): Promise<Dataset | null> {
  const [d] = await db
    .select()
    .from(datasetsTable)
    .where(and(eq(datasetsTable.id, datasetId), eq(datasetsTable.userId, userId)));
  return d ?? null;
}

router.get("/datasets", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const hostId = req.query.hostId as string | undefined;

  if (hostId) {
    // Guest mode: return the host's datasets if the user has active guest access
    const hostIds = await getActiveHostIds(userId);
    if (!hostIds.includes(hostId)) {
      res.status(403).json({ error: "Kein Zugriff auf diese Betriebe." });
      return;
    }
    const rows = await db
      .select()
      .from(datasetsTable)
      .where(eq(datasetsTable.userId, hostId))
      .orderBy(desc(datasetsTable.createdAt));
    const out = [];
    for (const d of rows) {
      const c = await counts(d.id);
      out.push({ ...serializeDataset(d, c.fileCount, c.rowCount), isShared: true });
    }
    res.json(out);
    return;
  }

  const rows = await db
    .select()
    .from(datasetsTable)
    .where(eq(datasetsTable.userId, userId))
    .orderBy(desc(datasetsTable.createdAt));
  const out = [];
  for (const d of rows) {
    const c = await counts(d.id);
    out.push(serializeDataset(d, c.fileCount, c.rowCount));
  }
  res.json(ListDatasetsResponse.parse(out));
});

router.post("/datasets", requireAuth, async (req: Request, res: Response) => {
  const parsed = CreateDatasetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  if (parsed.data.name.length > 200) {
    res.status(400).json({ error: "Name zu lang (max. 200 Zeichen)" });
    return;
  }
  if (parsed.data.description && parsed.data.description.length > 1_000) {
    res.status(400).json({ error: "Beschreibung zu lang (max. 1000 Zeichen)" });
    return;
  }
  const sector = normalizeSector(parsed.data.sector ?? "dairy");
  const [created] = await db
    .insert(datasetsTable)
    .values({
      userId: req.userId!,
      name: parsed.data.name,
      description: parsed.data.description,
      status: "empty",
      sector,
    } as any)
    .returning();
  res.status(201).json(serializeDataset(created, 0, 0));
});

router.get("/datasets/:datasetId", requireAuth, async (req: Request, res: Response) => {
  const { datasetId } = GetDatasetParams.parse(req.params);
  const userId = req.userId!;
  let d = await ownDataset(datasetId, userId);
  if (!d) {
    // Check guest access
    if (!(await canReadDataset(datasetId, userId))) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }
    const [shared] = await db.select().from(datasetsTable).where(eq(datasetsTable.id, datasetId));
    d = shared ?? null;
    if (!d) { res.status(404).json({ error: "Datensatz nicht gefunden" }); return; }
  }
  const c = await counts(d.id);
  res.json(GetDatasetResponse.parse(serializeDataset(d, c.fileCount, c.rowCount)));
});

router.patch("/datasets/:datasetId", requireAuth, async (req: Request, res: Response) => {
  const { datasetId } = UpdateDatasetParams.parse(req.params);
  const parsed = UpdateDatasetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  if (parsed.data.name && parsed.data.name.length > 200) {
    res.status(400).json({ error: "Name zu lang (max. 200 Zeichen)" });
    return;
  }
  if (parsed.data.description && parsed.data.description.length > 1_000) {
    res.status(400).json({ error: "Beschreibung zu lang (max. 1000 Zeichen)" });
    return;
  }
  const d = await ownDataset(datasetId, req.userId!);
  if (!d) {
    res.status(404).json({ error: "Datensatz nicht gefunden" });
    return;
  }
  const [updated] = await db
    .update(datasetsTable)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      ...(parsed.data.sector !== undefined
        ? { sector: normalizeSector(parsed.data.sector) }
        : {}),
      updatedAt: new Date(),
    } as any)
    .where(eq(datasetsTable.id, datasetId))
    .returning();
  const c = await counts(datasetId);
  res.json(UpdateDatasetResponse.parse(serializeDataset(updated, c.fileCount, c.rowCount)));
});

router.delete("/datasets/:datasetId", requireAuth, async (req: Request, res: Response) => {
  const { datasetId } = DeleteDatasetParams.parse(req.params);
  const d = await ownDataset(datasetId, req.userId!);
  if (!d) {
    res.status(404).json({ error: "Datensatz nicht gefunden" });
    return;
  }
  // Delete child analyses and their messages first (no FK cascade in schema).
  const linkedAnalyses = await db
    .select({ id: analysesTable.id })
    .from(analysesTable)
    .where(eq(analysesTable.datasetId, datasetId));
  if (linkedAnalyses.length > 0) {
    const { inArray } = await import("drizzle-orm");
    const analysisIds = linkedAnalyses.map((a) => a.id);
    // DSGVO: clean up chat image files from object storage before deleting message rows
    try {
      const msgRows = await db
        .select({ imageObjectPath: messagesTable.imageObjectPath } as any)
        .from(messagesTable)
        .where(inArray(messagesTable.analysisId, analysisIds));
      const imagePaths = (msgRows as any[])
        .map((r: any) => r.imageObjectPath)
        .filter((p: unknown): p is string => typeof p === "string" && p.length > 0);
      if (imagePaths.length > 0) {
        const storageService = new ObjectStorageService();
        await Promise.allSettled(
          imagePaths.map(async (path: string) => {
            try {
              const file = await storageService.getObjectEntityFile(path);
              await file.delete();
            } catch (err) {
              logger.warn({ err, path }, "Chat-Bild konnte nicht aus Object-Storage gelöscht werden");
            }
          }),
        );
      }
    } catch (err) {
      logger.warn({ err }, "Chat-Bild DSGVO-Bereinigung fehlgeschlagen — Datenbankzeilen werden trotzdem gelöscht");
    }
    await db.delete(messagesTable).where(inArray(messagesTable.analysisId, analysisIds));
  }
  await db.delete(analysesTable).where(eq(analysesTable.datasetId, datasetId));
  await db.delete(reportsTable).where(eq(reportsTable.datasetId, datasetId));
  await db.delete(dataRowsTable).where(eq(dataRowsTable.datasetId, datasetId));
  await db.delete(sourceFilesTable).where(eq(sourceFilesTable.datasetId, datasetId));
  await db.delete(warningsTable).where(eq(warningsTable.datasetId, datasetId));
  await db.delete(contextFactsTable).where(eq(contextFactsTable.datasetId, datasetId));
  await db.delete(activityLogTable).where(eq(activityLogTable.datasetRef, datasetId.slice(0, 8)));
  await db.delete(datasetsTable).where(eq(datasetsTable.id, datasetId));
  res.status(204).end();
});

router.get(
  "/datasets/:datasetId/overview",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = GetDatasetOverviewParams.parse(req.params);
    const userId = req.userId!;
    let d = await ownDataset(datasetId, userId);
    if (!d) {
      if (!(await canReadDataset(datasetId, userId))) {
        res.status(404).json({ error: "Datensatz nicht gefunden" });
        return;
      }
      const [shared] = await db.select().from(datasetsTable).where(eq(datasetsTable.id, datasetId));
      d = shared ?? null;
      if (!d) { res.status(404).json({ error: "Datensatz nicht gefunden" }); return; }
    }
    const { kpis, charts } = await computeDashboard(datasetId);
    const [w] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(warningsTable)
      .where(and(eq(warningsTable.datasetId, datasetId), eq(warningsTable.status, "open")));
    res.json(
      GetDatasetOverviewResponse.parse({
        datasetId,
        status: mapDatasetStatus(d.status),
        kpis,
        charts,
        warningCount: w?.c ?? 0,
        lastUpdated: d.updatedAt ?? null,
      }),
    );
  },
);

const SUGGESTION_DEFS: {
  needs: string[];
  question: string;
  category: string;
}[] = [
  {
    needs: ["milk_yield_kg"],
    question: "Wie hat sich die Milchleistung in den letzten Monaten entwickelt?",
    category: "Milchleistung",
  },
  {
    needs: ["scc"],
    question: "Gibt es Tiere mit auffällig hoher Zellzahl?",
    category: "Eutergesundheit",
  },
  {
    needs: ["fat_pct", "protein_pct"],
    question: "Wie entwickelt sich das Fett-Eiweiß-Verhältnis im Zeitverlauf?",
    category: "Inhaltsstoffe",
  },
  {
    needs: ["urea"],
    question: "Was sagt der Harnstoffgehalt über die Fütterung aus?",
    category: "Fütterung",
  },
  {
    needs: ["milk_yield_kg", "lactation_number"],
    question: "Wie unterscheidet sich die Milchleistung nach Laktationsnummer?",
    category: "Milchleistung",
  },
  {
    needs: ["milk_yield_kg", "animal_id"],
    question: "Welche Tiere haben die höchste und niedrigste Milchleistung?",
    category: "Milchleistung",
  },
];

router.get(
  "/datasets/:datasetId/suggestions",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = GetQuestionSuggestionsParams.parse(req.params);
    const userId = req.userId!;
    const allowed = await ownDataset(datasetId, userId) !== null || await canReadDataset(datasetId, userId);
    if (!allowed) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }
    const schema = await getDatasetSchema(datasetId);
    const present = new Set(schema.fields.map((f) => f.key));
    const out = SUGGESTION_DEFS.filter((s) => s.needs.every((n) => present.has(n)))
      .slice(0, 6)
      .map((s, i) => ({ id: `sug_${i}`, question: s.question, category: s.category }));
    res.json(GetQuestionSuggestionsResponse.parse(out));
  },
);

export default router;

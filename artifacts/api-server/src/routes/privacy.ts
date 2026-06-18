import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  datasetsTable,
  sourceFilesTable,
  dataRowsTable,
  analysesTable,
  messagesTable,
  rulesTable,
  warningsTable,
  reportsTable,
  activityLogTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

// Cap parsed rows per export to avoid huge responses (DSGVO export is for
// data portability; users needing full raw data can re-download their files).
const EXPORT_ROWS_LIMIT = 10_000;

router.post("/privacy/export", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;

  const datasets = await db
    .select()
    .from(datasetsTable)
    .where(eq(datasetsTable.userId, userId));

  const datasetIds = datasets.map((d) => d.id);

  const [analyses, rules, warnings, reports, files] = await Promise.all([
    db.select().from(analysesTable).where(eq(analysesTable.userId, userId)),
    db.select().from(rulesTable).where(eq(rulesTable.userId, userId)),
    db.select().from(warningsTable).where(eq(warningsTable.userId, userId)),
    db.select().from(reportsTable).where(eq(reportsTable.userId, userId)),
    datasetIds.length > 0
      ? db.select().from(sourceFilesTable).where(inArray(sourceFilesTable.datasetId, datasetIds))
      : Promise.resolve([]),
  ]);

  const analysisIds = analyses.map((a) => a.id);
  const messages =
    analysisIds.length > 0
      ? await db.select().from(messagesTable).where(inArray(messagesTable.analysisId, analysisIds))
      : [];

  const analysesWithMessages = analyses.map((a) => ({
    ...a,
    messages: messages.filter((m) => m.analysisId === a.id),
  }));

  // Include parsed canonical rows (capped for response size).
  const dataRows =
    datasetIds.length > 0
      ? await db
          .select()
          .from(dataRowsTable)
          .where(inArray(dataRowsTable.datasetId, datasetIds))
          .limit(EXPORT_ROWS_LIMIT)
      : [];

  // Generate short-lived download URLs for uploaded file objects.
  const filesWithDownload = await Promise.all(
    files.map(async (f) => {
      const { objectPath: _op, ...meta } = f;
      let downloadUrl: string | null = null;
      try {
        const obj = await objectStorage.getObjectEntityFile(f.objectPath);
        [downloadUrl] = await obj.getSignedUrl({ action: "read", expires: Date.now() + 3600_000 });
      } catch {
        // Object may be missing or storage unavailable.
      }
      return { ...meta, downloadUrl };
    }),
  );

  res.json({
    generatedAt: new Date(),
    note: dataRows.length === EXPORT_ROWS_LIMIT
      ? `Parsed rows capped at ${EXPORT_ROWS_LIMIT}. Download your original files for the full dataset.`
      : undefined,
    datasets,
    analyses: analysesWithMessages,
    rules,
    warnings,
    reports,
    files: filesWithDownload,
    dataRows,
  });
});

router.delete("/privacy/data", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;

  const datasets = await db
    .select({ id: datasetsTable.id })
    .from(datasetsTable)
    .where(eq(datasetsTable.userId, userId));
  const datasetIds = datasets.map((d) => d.id);

  // Best-effort deletion of stored objects.
  const files = await db
    .select()
    .from(sourceFilesTable)
    .where(eq(sourceFilesTable.userId, userId));
  for (const f of files) {
    try {
      const obj = await objectStorage.getObjectEntityFile(f.objectPath);
      await obj.delete();
    } catch {
      // Object may already be gone; continue.
    }
  }

  const analyses = await db
    .select({ id: analysesTable.id })
    .from(analysesTable)
    .where(eq(analysesTable.userId, userId));
  const analysisIds = analyses.map((a) => a.id);

  if (analysisIds.length > 0) {
    await db.delete(messagesTable).where(inArray(messagesTable.analysisId, analysisIds));
  }
  await db.delete(analysesTable).where(eq(analysesTable.userId, userId));
  if (datasetIds.length > 0) {
    await db.delete(dataRowsTable).where(inArray(dataRowsTable.datasetId, datasetIds));
  }
  await db.delete(sourceFilesTable).where(eq(sourceFilesTable.userId, userId));
  await db.delete(warningsTable).where(eq(warningsTable.userId, userId));
  await db.delete(reportsTable).where(eq(reportsTable.userId, userId));
  await db.delete(rulesTable).where(eq(rulesTable.userId, userId));
  await db.delete(datasetsTable).where(eq(datasetsTable.userId, userId));
  await db.delete(activityLogTable).where(eq(activityLogTable.userId, userId));

  res.status(204).end();
});

export default router;

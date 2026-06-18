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
import { ExportMyDataResponse } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

router.post("/privacy/export", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const datasets = await db
    .select()
    .from(datasetsTable)
    .where(eq(datasetsTable.userId, userId));
  const analyses = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.userId, userId));
  const rules = await db
    .select()
    .from(rulesTable)
    .where(eq(rulesTable.userId, userId));

  const analysesWithMessages = [];
  for (const a of analyses) {
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.analysisId, a.id));
    analysesWithMessages.push({ ...a, messages: msgs });
  }

  res.json(
    ExportMyDataResponse.parse({
      generatedAt: new Date(),
      datasets: datasets as unknown as Record<string, unknown>[],
      analyses: analysesWithMessages as unknown as Record<string, unknown>[],
      rules: rules as unknown as Record<string, unknown>[],
    }),
  );
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

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  datasetsTable,
  sourceFilesTable,
  dataRowsTable,
  type SourceFile,
} from "@workspace/db";
import {
  ListFilesParams,
  ListFilesResponse,
  RegisterFileParams,
  RegisterFileBody,
  GetFileParams,
  GetFileResponse,
  DeleteFileParams,
  UpdateColumnMappingParams,
  UpdateColumnMappingBody,
  UpdateColumnMappingResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { serializeFile } from "../lib/serializers";
import { ingestFile, remapFile, refreshDatasetStatus } from "../lib/ingest";
import { ObjectStorageService, ObjectAclConflictError } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

async function ownDatasetId(datasetId: string, userId: string): Promise<boolean> {
  const [d] = await db
    .select({ id: datasetsTable.id })
    .from(datasetsTable)
    .where(and(eq(datasetsTable.id, datasetId), eq(datasetsTable.userId, userId)));
  return !!d;
}

async function ownFile(fileId: string, userId: string): Promise<SourceFile | null> {
  const [f] = await db
    .select()
    .from(sourceFilesTable)
    .where(and(eq(sourceFilesTable.id, fileId), eq(sourceFilesTable.userId, userId)));
  return f ?? null;
}

router.get(
  "/datasets/:datasetId/files",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = ListFilesParams.parse(req.params);
    if (!(await ownDatasetId(datasetId, req.userId!))) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }
    const rows = await db
      .select()
      .from(sourceFilesTable)
      .where(eq(sourceFilesTable.datasetId, datasetId))
      .orderBy(desc(sourceFilesTable.createdAt));
    res.json(ListFilesResponse.parse(rows.map((f) => serializeFile(f))));
  },
);

router.post(
  "/datasets/:datasetId/files",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = RegisterFileParams.parse(req.params);
    const parsed = RegisterFileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ungültige Eingabe" });
      return;
    }
    if (!(await ownDatasetId(datasetId, req.userId!))) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }

    let objectPath = parsed.data.objectPath;
    try {
      objectPath = await objectStorage.trySetObjectEntityAclPolicy(objectPath, {
        owner: req.userId!,
        visibility: "private",
      });
    } catch (err) {
      if (err instanceof ObjectAclConflictError) {
        req.log.warn({ err }, "ACL-Konflikt beim Registrieren der Datei");
        res.status(403).json({ error: "Kein Zugriff auf dieses Objekt" });
        return;
      }
      req.log.error({ err }, "ACL konnte nicht gesetzt werden");
      res
        .status(502)
        .json({ error: "Datei konnte nicht sicher registriert werden" });
      return;
    }

    const [created] = await db
      .insert(sourceFilesTable)
      .values({
        datasetId,
        userId: req.userId!,
        name: parsed.data.name,
        objectPath,
        contentType: parsed.data.contentType,
        size: parsed.data.size,
        status: "uploaded",
      })
      .returning();

    await db
      .update(datasetsTable)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(datasetsTable.id, datasetId));

    // Fire-and-forget background ingestion.
    void ingestFile(created.id);

    res.status(201).json(serializeFile(created));
  },
);

router.get("/files/:fileId", requireAuth, async (req: Request, res: Response) => {
  const { fileId } = GetFileParams.parse(req.params);
  const f = await ownFile(fileId, req.userId!);
  if (!f) {
    res.status(404).json({ error: "Datei nicht gefunden" });
    return;
  }
  res.json(GetFileResponse.parse(serializeFile(f, true)));
});

router.delete("/files/:fileId", requireAuth, async (req: Request, res: Response) => {
  const { fileId } = DeleteFileParams.parse(req.params);
  const f = await ownFile(fileId, req.userId!);
  if (!f) {
    res.status(404).json({ error: "Datei nicht gefunden" });
    return;
  }
  await db.delete(dataRowsTable).where(eq(dataRowsTable.fileId, fileId));
  await db.delete(sourceFilesTable).where(eq(sourceFilesTable.id, fileId));
  await refreshDatasetStatus(f.datasetId);
  res.status(204).end();
});

router.patch(
  "/files/:fileId/mapping",
  requireAuth,
  async (req: Request, res: Response) => {
    const { fileId } = UpdateColumnMappingParams.parse(req.params);
    const parsed = UpdateColumnMappingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ungültige Eingabe" });
      return;
    }
    const f = await ownFile(fileId, req.userId!);
    if (!f) {
      res.status(404).json({ error: "Datei nicht gefunden" });
      return;
    }
    const mapping: Record<string, string> = {};
    for (const m of parsed.data.mappings) {
      if (m.canonicalField) mapping[m.sourceColumn] = m.canonicalField;
    }
    try {
      await remapFile(fileId, mapping);
    } catch (err) {
      req.log.error({ err, fileId }, "Neuzuordnung fehlgeschlagen");
      res.status(500).json({ error: "Neuzuordnung fehlgeschlagen" });
      return;
    }
    const updated = await ownFile(fileId, req.userId!);
    res.json(UpdateColumnMappingResponse.parse(serializeFile(updated!, true)));
  },
);

export default router;

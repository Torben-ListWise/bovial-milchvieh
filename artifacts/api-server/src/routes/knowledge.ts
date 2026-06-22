import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
} from "@workspace/db";
import { requireAuth, requireOperator } from "../lib/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { ingestKnowledgeDoc } from "../lib/ingest";
import { logger } from "../lib/logger";

interface KnowledgeUploadUrlBodyType {
  filename: string;
  contentType: string;
  size: number;
  title?: string;
}

const KnowledgeUploadUrlBody = {
  safeParse(body: unknown): { success: true; data: KnowledgeUploadUrlBodyType } | { success: false } {
    if (
      typeof body !== "object" || body === null ||
      typeof (body as any).filename !== "string" || !(body as any).filename ||
      typeof (body as any).contentType !== "string" || !(body as any).contentType ||
      typeof (body as any).size !== "number" || (body as any).size < 1
    ) {
      return { success: false };
    }
    return {
      success: true,
      data: {
        filename: (body as any).filename,
        contentType: (body as any).contentType,
        size: (body as any).size,
        title: typeof (body as any).title === "string" ? (body as any).title : undefined,
      },
    };
  },
};

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

router.get(
  "/knowledge",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const docs = await db
      .select()
      .from(knowledgeDocumentsTable)
      .orderBy(desc(knowledgeDocumentsTable.createdAt));
    res.json(
      docs.map((d) => ({
        id: d.id,
        title: d.title,
        filename: d.filename,
        fileType: d.fileType,
        status: d.status,
        chunkCount: d.chunkCount ?? null,
        size: d.size ?? null,
        errorMessage: d.errorMessage ?? null,
        createdAt: d.createdAt,
      })),
    );
  },
);

router.post(
  "/knowledge/upload-url",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const parsed = KnowledgeUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ungültige Eingabe" });
      return;
    }
    const { filename, contentType, size, title } = parsed.data;
    const l = filename.toLowerCase();
    const fileType = l.endsWith(".pptx") || l.endsWith(".ppt") ? "pptx"
      : l.endsWith(".docx") || l.endsWith(".doc") ? "docx"
      : l.endsWith(".xlsx") || l.endsWith(".xls") || l.endsWith(".ods") ? "excel"
      : l.endsWith(".csv") ? "csv"
      : l.endsWith(".tsv") ? "tsv"
      : l.endsWith(".txt") ? "txt"
      : "pdf";
    const docTitle =
      title?.trim() ||
      filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();

    let uploadURL: string;
    let objectPath: string;
    try {
      uploadURL = await objectStorage.getObjectEntityUploadURL();
      objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    } catch (err) {
      logger.error({ err }, "Signed URL Erstellung fehlgeschlagen");
      res.status(502).json({ error: "Upload-URL konnte nicht erstellt werden" });
      return;
    }

    try {
      objectPath = await objectStorage.trySetObjectEntityAclPolicy(uploadURL, {
        owner: req.userId!,
        visibility: "private",
      });
    } catch {
      objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    }

    const [doc] = await db
      .insert(knowledgeDocumentsTable)
      .values({
        title: docTitle,
        filename,
        fileType,
        objectPath,
        status: "pending",
        size,
        uploadedBy: req.userId!,
      })
      .returning();

    res.json({ uploadURL, objectPath, docId: doc.id, title: docTitle });
  },
);

router.post(
  "/knowledge/:id/ingest",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const [doc] = await db
      .select({ id: knowledgeDocumentsTable.id })
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Dokument nicht gefunden" });
      return;
    }
    void ingestKnowledgeDoc(id);
    res.json({ accepted: true });
  },
);

router.delete(
  "/knowledge/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const [doc] = await db
      .select()
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Dokument nicht gefunden" });
      return;
    }

    await db
      .delete(knowledgeChunksTable)
      .where(eq(knowledgeChunksTable.docId, id));

    try {
      const file = await objectStorage.getObjectEntityFile(doc.objectPath);
      await file.delete();
    } catch (err) {
      logger.warn({ err, id }, "Objekt konnte nicht gelöscht werden");
    }

    await db
      .delete(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.id, id));

    res.status(204).end();
  },
);

export { router as knowledgeRouter };

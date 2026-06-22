import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
} from "@workspace/db";
import { requireAuth, requireOperator } from "../lib/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { ingestKnowledgeDoc } from "../lib/ingest";
import { scrapeUrl, validateUrl, canonicalizeUrl } from "../lib/scraper";
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
        sourceUrl: d.sourceUrl ?? null,
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
  "/knowledge/ingest-url",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const body = req.body as unknown;
    if (
      typeof body !== "object" || body === null ||
      typeof (body as any).url !== "string" || !(body as any).url
    ) {
      res.status(400).json({ error: "Ungültige Eingabe: 'url' fehlt" });
      return;
    }
    const rawUrl: string = (body as any).url.trim();

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: "Ungültige URL" });
      return;
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      res.status(400).json({ error: "Nur http:// und https:// URLs sind erlaubt" });
      return;
    }

    // SSRF check before anything else
    try {
      await validateUrl(rawUrl);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "URL nicht erlaubt" });
      return;
    }

    const canonicalUrl = canonicalizeUrl(rawUrl);

    // Deduplication: check both the raw and canonical forms
    const allDocs = await db
      .select({ sourceUrl: knowledgeDocumentsTable.sourceUrl })
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.sourceUrl, canonicalUrl))
      .limit(1);
    const isDuplicate =
      allDocs.length > 0 ||
      (canonicalUrl !== rawUrl &&
        (await db
          .select({ sourceUrl: knowledgeDocumentsTable.sourceUrl })
          .from(knowledgeDocumentsTable)
          .where(eq(knowledgeDocumentsTable.sourceUrl, rawUrl))
          .limit(1)
          .then((r) => r.length > 0)));
    if (isDuplicate) {
      res.status(409).json({
        error: "Diese URL wurde bereits zur Wissensbibliothek hinzugefügt",
      });
      return;
    }

    // Create doc row immediately with a placeholder objectPath so the frontend
    // can start polling. The real path is set once the upload succeeds.
    const placeholder = `knowledge/url-${randomUUID()}.txt`;
    const [doc] = await db
      .insert(knowledgeDocumentsTable)
      .values({
        title: parsedUrl.hostname,
        filename: parsedUrl.hostname,
        fileType: "txt",
        objectPath: placeholder,
        status: "processing",
        sourceUrl: canonicalUrl,
        uploadedBy: req.userId!,
      })
      .returning();

    // Return immediately so the frontend can start polling.
    res.json({ docId: doc.id });

    // Run scrape + upload + ingest entirely in background.
    void (async () => {
      try {
        const scraped = await scrapeUrl(rawUrl);
        const buf = Buffer.from(scraped.text, "utf-8");
        const objectPath = await objectStorage.uploadBytesAsEntity(placeholder, buf, "text/plain");

        await db
          .update(knowledgeDocumentsTable)
          .set({
            title: scraped.title || parsedUrl.hostname,
            objectPath,
            size: buf.length,
          })
          .where(eq(knowledgeDocumentsTable.id, doc.id));

        await ingestKnowledgeDoc(doc.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "URL konnte nicht geladen werden";
        logger.warn({ err, url: rawUrl, docId: doc.id }, "URL-Ingestion fehlgeschlagen");
        await db
          .update(knowledgeDocumentsTable)
          .set({ status: "error", errorMessage: message })
          .where(eq(knowledgeDocumentsTable.id, doc.id));
      }
    })();
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

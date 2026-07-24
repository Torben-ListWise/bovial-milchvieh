import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, and, inArray, isNotNull, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
  knowledgeDocumentTopicsTable,
  KNOWLEDGE_TOPICS,
} from "@workspace/db";
import { requireAuth, requireOperator } from "../lib/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { ingestKnowledgeDoc } from "../lib/ingest";
import { scrapeUrl, validateUrl, canonicalizeUrl } from "../lib/scraper";
import { logger } from "../lib/logger";
import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../lib/agent";
import {
  extractDocumentMetadata,
  confirmDocumentMetadata,
  runBatchMetadataExtraction,
} from "../lib/knowledgeMetadata";

interface KnowledgeUploadUrlBodyType {
  filename: string;
  contentType: string;
  size: number;
  title?: string;
  documentType?: string;
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
        documentType: typeof (body as any).documentType === "string" ? (body as any).documentType : undefined,
      },
    };
  },
};

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

function serializeDoc(d: typeof knowledgeDocumentsTable.$inferSelect) {
  return {
    id: d.id,
    title: d.title,
    filename: d.filename,
    fileType: d.fileType,
    status: d.status,
    chunkCount: d.chunkCount ?? null,
    size: d.size ?? null,
    errorMessage: d.errorMessage ?? null,
    sourceUrl: d.sourceUrl ?? null,
    category: d.category ?? null,
    documentType: d.documentType ?? null,
    metaTitel: d.metaTitel ?? null,
    metaAutoren: d.metaAutoren ?? null,
    metaJahr: d.metaJahr ?? null,
    metaHerausgeber: d.metaHerausgeber ?? null,
    metaUrl: d.metaUrl ?? null,
    tierStufe: d.tierStufe ?? null,
    metaPending: d.metaPending ?? null,
    createdAt: d.createdAt,
  };
}

router.get(
  "/knowledge",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const docs = await db
      .select()
      .from(knowledgeDocumentsTable)
      .orderBy(desc(knowledgeDocumentsTable.createdAt));

    const docIds = docs.filter((d) => d.status === "ready").map((d) => d.id);
    const topicRows = docIds.length
      ? await db
          .select()
          .from(knowledgeDocumentTopicsTable)
          .where(inArray(knowledgeDocumentTopicsTable.docId, docIds))
      : [];
    const topicsByDocId = new Map<string, string[]>();
    for (const r of topicRows) {
      if (!topicsByDocId.has(r.docId)) topicsByDocId.set(r.docId, []);
      topicsByDocId.get(r.docId)!.push(r.topic);
    }

    res.json(
      docs.map((d) => ({
        ...serializeDoc(d),
        topics: topicsByDocId.get(d.id) ?? [],
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
    const { filename, contentType, size, title, documentType } = parsed.data;
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

    const SINGLE_ACTIVE_TYPES = ["benchmark_reference", "dairycomp_manual", "farm_abbreviations", "app_faq"] as const;
    if (documentType && (SINGLE_ACTIVE_TYPES as readonly string[]).includes(documentType)) {
      const [existingDoc] = await db
        .select()
        .from(knowledgeDocumentsTable)
        .where(eq(knowledgeDocumentsTable.documentType, documentType))
        .limit(1);
      if (existingDoc) {
        await db
          .delete(knowledgeChunksTable)
          .where(eq(knowledgeChunksTable.docId, existingDoc.id));
        await db
          .delete(knowledgeDocumentTopicsTable)
          .where(eq(knowledgeDocumentTopicsTable.docId, existingDoc.id));
        try {
          const file = await objectStorage.getObjectEntityFile(existingDoc.objectPath);
          await file.delete();
        } catch (err) {
          logger.warn(
            { err, id: existingDoc.id, documentType },
            "Altes Single-Active-Dokument konnte nicht aus Object-Storage gelöscht werden",
          );
        }
        await db
          .delete(knowledgeDocumentsTable)
          .where(eq(knowledgeDocumentsTable.id, existingDoc.id));
        logger.info(
          { id: existingDoc.id, documentType },
          "Bestehendes Single-Active-Dokument ersetzt",
        );
      }
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
        documentType: documentType ?? null,
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

    try {
      await validateUrl(rawUrl);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "URL nicht erlaubt" });
      return;
    }

    const canonicalUrl = canonicalizeUrl(rawUrl);

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

    res.json({ docId: doc.id });

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
        void triggerMetadataExtraction(doc.id);
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

async function triggerMetadataExtraction(docId: string): Promise<void> {
  try {
    const meta = await extractDocumentMetadata(docId);
    if (meta) {
      await db
        .update(knowledgeDocumentsTable)
        .set({ metaPending: meta })
        .where(eq(knowledgeDocumentsTable.id, docId));
      logger.info({ docId }, "Metadaten-Extraktion abgeschlossen, steht zur Bestätigung bereit");
    }
  } catch (err) {
    logger.warn({ err, docId }, "Metadaten-Extraktion nach Ingestion fehlgeschlagen");
  }
}

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
    void (async () => {
      await ingestKnowledgeDoc(id);
      void triggerMetadataExtraction(id);
    })();
    res.json({ accepted: true });
  },
);

router.post(
  "/knowledge/:id/mark-upload-error",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const message =
      typeof (req.body as any)?.message === "string"
        ? (req.body as any).message
        : "Upload fehlgeschlagen";
    const [updated] = await db
      .update(knowledgeDocumentsTable)
      .set({ status: "error", errorMessage: message })
      .where(eq(knowledgeDocumentsTable.id, id))
      .returning({ id: knowledgeDocumentsTable.id });
    if (!updated) {
      res.status(404).json({ error: "Dokument nicht gefunden" });
      return;
    }
    logger.warn({ docId: id, message }, "Knowledge-Dokument Upload-Fehler markiert");
    res.json({ ok: true });
  },
);

router.post(
  "/knowledge/:id/extract-metadata",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const [doc] = await db
      .select({ id: knowledgeDocumentsTable.id, status: knowledgeDocumentsTable.status })
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Dokument nicht gefunden" });
      return;
    }
    if (doc.status !== "ready") {
      res.status(400).json({ error: "Dokument ist noch nicht bereit (status != ready)" });
      return;
    }
    res.json({ accepted: true });
    void triggerMetadataExtraction(id);
  },
);

router.post(
  "/knowledge/:id/confirm-metadata",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const body = req.body as {
      metaTitel?: string | null;
      metaAutoren?: string | null;
      metaJahr?: number | null;
      metaHerausgeber?: string | null;
      metaUrl?: string | null;
      tierStufe?: number | null;
      topics?: string[];
    };

    // Always validate topics; empty array is valid (clears existing)
    const validTopics = (body.topics ?? []).filter((t) =>
      (KNOWLEDGE_TOPICS as readonly string[]).includes(t),
    );

    try {
      await confirmDocumentMetadata(id, {
        metaTitel: body.metaTitel ?? null,
        metaAutoren: body.metaAutoren ?? null,
        metaJahr: body.metaJahr ?? null,
        metaHerausgeber: body.metaHerausgeber ?? null,
        metaUrl: body.metaUrl ?? null,
        tierStufe: body.tierStufe ?? null,
        topics: validTopics,
      });
      logger.info({ docId: id, topics: validTopics }, "Metadaten bestätigt");
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, docId: id }, "Metadaten-Bestätigung fehlgeschlagen");
      res.status(500).json({ error: "Metadaten konnten nicht gespeichert werden" });
    }
  },
);

router.post(
  "/knowledge/:id/dismiss-metadata",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    await db
      .update(knowledgeDocumentsTable)
      .set({ metaPending: null })
      .where(eq(knowledgeDocumentsTable.id, id));
    res.json({ ok: true });
  },
);

router.post(
  "/knowledge/batch-extract-metadata",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "ANTHROPIC_API_KEY nicht konfiguriert" });
      return;
    }

    const docs = await db
      .select({ id: knowledgeDocumentsTable.id })
      .from(knowledgeDocumentsTable)
      .where(
        and(
          eq(knowledgeDocumentsTable.status, "ready"),
          isNull(knowledgeDocumentsTable.tierStufe),
          isNull(knowledgeDocumentsTable.metaPending),
        ),
      );

    if (docs.length === 0) {
      res.json({ queued: 0, message: "Alle Dokumente haben bereits Metadaten oder stehen zur Bestätigung" });
      return;
    }

    res.json({ queued: docs.length, message: `${docs.length} Dokumente werden im Hintergrund verarbeitet` });

    void runBatchMetadataExtraction().then(({ processed, incomplete }) => {
      logger.info({ processed, incomplete }, "Batch-Metadaten-Extraktion abgeschlossen");
    });
  },
);

router.get(
  "/knowledge/incomplete-metadata",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    // Return docs in two categories:
    // 1. "incomplete" — extraction ran but couldn't determine bibliographic fields
    // 2. "never_extracted" — ready but no metaPending and no confirmed tierStufe
    const docs = await db
      .select()
      .from(knowledgeDocumentsTable)
      .where(
        and(
          eq(knowledgeDocumentsTable.status, "ready"),
          isNull(knowledgeDocumentsTable.tierStufe),
        ),
      )
      .orderBy(desc(knowledgeDocumentsTable.createdAt));

    const withStatus = docs.map((d) => {
      const pending = d.metaPending as { _extractionStatus?: string } | null;
      const extractionStatus =
        pending?._extractionStatus === "incomplete"
          ? "incomplete"
          : pending === null
            ? "never_extracted"
            : "pending_review";
      return { ...serializeDoc(d), extractionStatus };
    });

    res.json(withStatus);
  },
);

router.patch(
  "/knowledge/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { category, title, documentType, metaTitel, metaAutoren, metaJahr, metaHerausgeber, metaUrl, tierStufe, topics } = req.body as {
      category?: string;
      title?: string;
      documentType?: string | null;
      metaTitel?: string | null;
      metaAutoren?: string | null;
      metaJahr?: number | null;
      metaHerausgeber?: string | null;
      metaUrl?: string | null;
      tierStufe?: number | null;
      topics?: string[];
    };
    const patch: Record<string, unknown> = {};
    if (typeof category === "string") patch.category = category || null;
    if (typeof title === "string" && title.trim()) patch.title = title.trim();
    if (documentType !== undefined) patch.documentType = documentType || null;
    if (metaTitel !== undefined) patch.metaTitel = metaTitel || null;
    if (metaAutoren !== undefined) patch.metaAutoren = metaAutoren || null;
    if (metaJahr !== undefined) patch.metaJahr = metaJahr || null;
    if (metaHerausgeber !== undefined) patch.metaHerausgeber = metaHerausgeber || null;
    if (metaUrl !== undefined) patch.metaUrl = metaUrl || null;
    if (tierStufe !== undefined) patch.tierStufe = tierStufe || null;

    if (Object.keys(patch).length === 0 && topics === undefined) {
      res.status(400).json({ error: "Nichts zu aktualisieren" });
      return;
    }

    const SINGLE_ACTIVE_TYPES = ["benchmark_reference", "dairycomp_manual", "farm_abbreviations", "app_faq"] as const;
    if (
      typeof documentType === "string" &&
      (SINGLE_ACTIVE_TYPES as readonly string[]).includes(documentType)
    ) {
      await db
        .update(knowledgeDocumentsTable)
        .set({ documentType: null })
        .where(
          and(
            eq(knowledgeDocumentsTable.documentType, documentType),
          ),
        );
    }

    let updated: typeof knowledgeDocumentsTable.$inferSelect | undefined;
    if (Object.keys(patch).length > 0) {
      const [result] = await db
        .update(knowledgeDocumentsTable)
        .set(patch)
        .where(eq(knowledgeDocumentsTable.id, id))
        .returning();
      updated = result;
      if (!updated) {
        res.status(404).json({ error: "Dokument nicht gefunden" });
        return;
      }
    }

    if (topics !== undefined) {
      const validTopics = topics.filter((t) =>
        (KNOWLEDGE_TOPICS as readonly string[]).includes(t),
      );
      await db
        .delete(knowledgeDocumentTopicsTable)
        .where(eq(knowledgeDocumentTopicsTable.docId, id));
      if (validTopics.length > 0) {
        await db.insert(knowledgeDocumentTopicsTable).values(
          validTopics.map((topic) => ({ docId: id, topic })),
        );
      }
    }

    const [finalDoc] = await db
      .select()
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.id, id));

    logger.info({ docId: id }, "Knowledge-Dokument aktualisiert");
    res.json({ ok: true, ...(finalDoc ? serializeDoc(finalDoc) : {}) });
  },
);

router.post(
  "/knowledge/categorize-all",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "ANTHROPIC_API_KEY nicht konfiguriert" });
      return;
    }

    const docs = await db
      .select({
        id: knowledgeDocumentsTable.id,
        title: knowledgeDocumentsTable.title,
        category: knowledgeDocumentsTable.category,
      })
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.status, "ready"));

    const uncategorized = docs.filter((d) => !d.category);
    if (uncategorized.length === 0) {
      res.json({ updated: 0, message: "Alle Dokumente sind bereits kategorisiert" });
      return;
    }

    const docIds = uncategorized.map((d) => d.id);
    const chunks = await db
      .select({
        docId: knowledgeChunksTable.docId,
        chunkText: knowledgeChunksTable.chunkText,
      })
      .from(knowledgeChunksTable)
      .where(and(
        inArray(knowledgeChunksTable.docId, docIds),
        eq(knowledgeChunksTable.chunkIndex, 0),
      ));

    const chunkByDocId = new Map(chunks.map((c) => [c.docId, c.chunkText]));

    const docList = uncategorized.map((d, i) => {
      const snippet = (chunkByDocId.get(d.id) ?? "").slice(0, 400);
      return `${i + 1}. Titel: "${d.title}"\n   Textauszug: ${snippet || "(kein Text verfügbar)"}`;
    }).join("\n\n");

    const prompt = `Du bist ein Assistent für eine landwirtschaftliche Wissensplattform. Kategorisiere die folgenden Dokumente nach ihrem Hauptthema. Wähle für jedes Dokument EINE passende Kategorie aus dieser Liste oder schlage eine neue vor, wenn keine passt:

Verfügbare Kategorien:
- Milchleistung & Laktation
- Eutergesundheit & Zellzahl
- Fruchtbarkeit & Reproduktion
- Tiergesundheit & Medizin
- Fütterung & Ernährung
- Herdenmanagement
- Recht & Förderung
- Technik & Stallbau
- Betriebswirtschaft
- Umwelt & Nachhaltigkeit
- Biogas & Energie
- Ackerbau & Pflanzenbau
- Schweinehaltung
- Geflügelhaltung
- Sonstiges

Dokumente:
${docList}

Antworte NUR mit einem JSON-Array in dieser Form, ohne weiteren Text:
[{"index":1,"category":"Eutergesundheit & Zellzahl"},{"index":2,"category":"Fruchtbarkeit & Reproduktion"},...]`;

    let categorized: Array<{ index: number; category: string }> = [];
    try {
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model: getModelForTask("doc_categorization"),
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = (msg.content[0] as { type: string; text: string }).text.trim();
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        categorized = JSON.parse(jsonMatch[0]) as Array<{ index: number; category: string }>;
      }
    } catch (err) {
      logger.error({ err }, "KI-Kategorisierung fehlgeschlagen");
      res.status(502).json({ error: "KI-Kategorisierung fehlgeschlagen" });
      return;
    }

    let updated = 0;
    for (const item of categorized) {
      const doc = uncategorized[item.index - 1];
      if (!doc || !item.category) continue;
      await db
        .update(knowledgeDocumentsTable)
        .set({ category: item.category })
        .where(eq(knowledgeDocumentsTable.id, doc.id));
      updated++;
    }

    logger.info({ updated, total: uncategorized.length }, "KI-Kategorisierung abgeschlossen");
    res.json({ updated, total: uncategorized.length });
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
      res.status(204).end();
      return;
    }

    await db
      .delete(knowledgeChunksTable)
      .where(eq(knowledgeChunksTable.docId, id));
    await db
      .delete(knowledgeDocumentTopicsTable)
      .where(eq(knowledgeDocumentTopicsTable.docId, id));

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

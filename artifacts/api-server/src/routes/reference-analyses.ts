import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  referenceAnalysesTable,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
} from "@workspace/db";
import { requireAuth, requireOperator } from "../lib/auth";
import { getModelForTask } from "../lib/agent";
import { SHARED_TERMINOLOGY_RULES, SHARED_DERIVATION_PROHIBITION } from "../lib/sharedDomainRules";
import { chunkText, embedTexts } from "../lib/embeddings";
import { logger } from "../lib/logger";
import Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();
const anthropic = new Anthropic();

// ── Predefined topic list (must match knowledge categorization) ───────────────
const VALID_TOPICS = [
  "Milchleistung & Laktation",
  "Eutergesundheit & Zellzahl",
  "Fruchtbarkeit & Reproduktion",
  "Tiergesundheit & Medizin",
  "Fütterung & Ernährung",
  "Herdenmanagement",
  "Betriebswirtschaft",
  "Technik & Stallbau",
];

// ── Extraction prompt ─────────────────────────────────────────────────────────
const EXTRACTION_SYSTEM_PROMPT = `Du bist ein Milchwirtschafts-Experte und destillierst aus konkreten Analysebeispielen allgemeingültige Interpretationsmuster für andere Betriebe.

ABSOLUTES VERBOT: Die extrahierten Texte dürfen KEINE konkreten Zahlen, Prozentwerte, Schwellenwerte oder betriebsspezifischen Messwerte aus dem Eingabebeispiel enthalten. Das Muster muss universell anwendbar sein.

${SHARED_TERMINOLOGY_RULES}

${SHARED_DERIVATION_PROHIBITION}

Deine Aufgabe:

1. DAIRYCOMP-BEFEHL (optional): Falls im Text ein DairyComp 305-Befehl erkennbar ist (LIST, SUM, EVENTS, SORT, GRAPH, BREDSUM\\E o.ä.), extrahiere ihn exakt (extractedCommand) und erstelle 4–6 deutsche Klartext-Synonyme, die beschreiben was der Befehl ausgibt (extractedCommandSynonyms). Achte dabei auf die Terminologie-Trennregel: BREDSUM\\E gibt die Pregnancy Rate aus — die Spalte "Preg/Bred" darin ist die Konzeptionsrate. Synonyme müssen diese Unterscheidung korrekt widerspiegeln. Wenn kein Befehl erkennbar ist, setze beide Felder auf null.

2. INTERPRETATIONSMUSTER (Pflicht): Schreibe ein generalisiertes Fachtext-Muster in 3–6 Sätzen. Struktur: "Auffällig [hohe/niedrige] [Kennzahl] im Bereich [Kontext] deutet meist auf [Ursache] hin. [Differentialdiagnose]. Stellschrauben: [generische Maßnahmen]." Keine Zahlen. Nicht betriebsspezifisch.

3. EINSTUFUNGSLOGIK (Pflicht): Beschreibe die Ampel-Einstufung für die relevante Kennzahl als graduelle Orientierung — NICHT gebunden an eine explizit benannte externe Quelle. Format: "Einschätzung [Kennzahl]: Ein [niedriger / hoher] Wert gilt in der Praxis als [auffällig / verbesserungswürdig]. Ein mittlerer Bereich gilt als [solide]. Ein [höherer / niedrigerer] Bereich gilt als [stark]. Diese Einschätzung ist als graduelle Orientierung aus der Zusammenschau von Fachbeispielen zu verstehen — keine Garantie."

4. THEMA: Wähle genau eines aus: Milchleistung & Laktation | Eutergesundheit & Zellzahl | Fruchtbarkeit & Reproduktion | Tiergesundheit & Medizin | Fütterung & Ernährung | Herdenmanagement | Betriebswirtschaft | Technik & Stallbau

Antworte ausschließlich als valides JSON ohne Markdown-Wrapper:
{
  "extractedCommand": "string or null",
  "extractedCommandSynonyms": ["string", ...] or null,
  "extractedPattern": "string",
  "extractedClassification": "string",
  "extractedTopic": "string"
}`;

// ── Helper: run AI extraction ─────────────────────────────────────────────────
async function runExtraction(
  textContent: string,
  imageBase64?: string,
  imageMimeType?: string,
): Promise<{
  extractedCommand: string | null;
  extractedCommandSynonyms: string[] | null;
  extractedPattern: string;
  extractedClassification: string;
  extractedTopic: string;
}> {
  const userContent: Anthropic.MessageParam["content"] = [];

  if (imageBase64 && imageMimeType) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageMimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data: imageBase64,
      },
    });
  }

  const textPart = textContent.trim()
    ? `Analysebeispiel:\n${textContent}`
    : "Analysiere den Screenshot oben.";
  userContent.push({ type: "text", text: textPart });

  const msg = await anthropic.messages.create({
    model: getModelForTask("benchmark_extraction"),
    max_tokens: 1200,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const raw = msg.content.find((b) => b.type === "text")?.text ?? "{}";
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("KI-Extraktion lieferte kein valides JSON");
  }

  const topic = VALID_TOPICS.includes(parsed.extractedTopic as string)
    ? (parsed.extractedTopic as string)
    : "Herdenmanagement";

  return {
    extractedCommand: typeof parsed.extractedCommand === "string" ? parsed.extractedCommand : null,
    extractedCommandSynonyms: Array.isArray(parsed.extractedCommandSynonyms)
      ? (parsed.extractedCommandSynonyms as string[])
      : null,
    extractedPattern: typeof parsed.extractedPattern === "string" ? parsed.extractedPattern : "",
    extractedClassification: typeof parsed.extractedClassification === "string"
      ? parsed.extractedClassification
      : "",
    extractedTopic: topic,
  };
}

// ── Helper: inject DairyComp synonyms into glossar doc ───────────────────────
async function injectDairycompSynonyms(
  command: string,
  synonyms: string[],
  adminUserId: string,
): Promise<void> {
  const [glossarDoc] = await db
    .select({ id: knowledgeDocumentsTable.id, chunkCount: knowledgeDocumentsTable.chunkCount })
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.documentType as any, "dairycomp_glossar"))
    .limit(1);

  if (!glossarDoc) {
    logger.warn({ adminUserId }, "DairyComp-Glossar-Dokument nicht gefunden — Synonyme nicht gespeichert");
    return;
  }

  const synonymText = `DairyComp-Befehl: ${command}\n${synonyms.join(" | ")}`;
  const chunks = chunkText(synonymText, 600, 0);
  const texts = chunks.map((c) => `passage: ${c}`);
  const embeddings = await embedTexts(texts);
  const maxIndex = (glossarDoc.chunkCount ?? 0);

  const rows = chunks.map((chunkTxt, i) => ({
    id: randomUUID(),
    docId: glossarDoc.id,
    chunkIndex: maxIndex + i,
    chunkText: chunkTxt,
    embedding: embeddings[i],
  }));

  await db.insert(knowledgeChunksTable).values(rows);
  await db
    .update(knowledgeDocumentsTable)
    .set({ chunkCount: maxIndex + rows.length })
    .where(eq(knowledgeDocumentsTable.id, glossarDoc.id));

  logger.info({ command, count: rows.length }, "DairyComp-Synonyme in Glossar injiziert");
}

// ── Helper: create knowledge document from confirmed pattern ──────────────────
async function confirmToKnowledge(
  refId: string,
  pattern: string,
  classification: string,
  topic: string,
  adminUserId: string,
): Promise<string> {
  const combinedText = [
    `Interpretationsmuster — ${topic}`,
    "",
    pattern,
    "",
    classification,
  ].join("\n");

  const docId = randomUUID();
  const title = `Referenzanalyse: ${topic} (${new Date().toLocaleDateString("de-DE")})`;

  await db.insert(knowledgeDocumentsTable).values({
    id: docId,
    title,
    filename: `referenzanalyse-${refId}.txt`,
    fileType: "txt",
    objectPath: `synthetic/reference-analyses/${refId}`,
    status: "ready",
    documentType: "analyse_referenz",
    category: topic,
    uploadedBy: adminUserId,
    embeddingModel: "multilingual-e5-base",
  });

  const chunks = chunkText(combinedText, 600, 100);
  const texts = chunks.map((c) => `passage: ${c}`);
  const embeddings = await embedTexts(texts);

  const rows = chunks.map((chunkTxt, i) => ({
    id: randomUUID(),
    docId,
    chunkIndex: i,
    chunkText: chunkTxt,
    embedding: embeddings[i],
  }));

  await db.insert(knowledgeChunksTable).values(rows);
  await db
    .update(knowledgeDocumentsTable)
    .set({ chunkCount: rows.length })
    .where(eq(knowledgeDocumentsTable.id, docId));

  return docId;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/admin/reference-analyses
router.get(
  "/admin/reference-analyses",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(referenceAnalysesTable)
      .orderBy(desc(referenceAnalysesTable.createdAt));
    res.json(rows);
  },
);

// POST /api/admin/reference-analyses
// Body: { rawText?: string, adminNote?: string, imageBase64?: string, imageMimeType?: string, uploadFilename?: string }
router.post(
  "/admin/reference-analyses",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { rawText, adminNote, imageBase64, imageMimeType, uploadFilename } = req.body ?? {};

    if (!rawText && !imageBase64) {
      res.status(400).json({ error: "rawText oder imageBase64 erforderlich" });
      return;
    }

    const rawInput = [rawText, adminNote].filter(Boolean).join("\n\n--- Einschätzung des Experten ---\n");

    let extraction: Awaited<ReturnType<typeof runExtraction>>;
    try {
      extraction = await runExtraction(rawInput, imageBase64, imageMimeType);
    } catch (err: unknown) {
      logger.error({ err }, "Referenzanalyse-Extraktion fehlgeschlagen");
      res.status(502).json({ error: "KI-Extraktion fehlgeschlagen — bitte erneut versuchen" });
      return;
    }

    const [row] = await db
      .insert(referenceAnalysesTable)
      .values({
        adminUserId: req.userId!,
        status: "pending_review",
        rawInput,
        adminNote: adminNote ?? null,
        uploadFilename: uploadFilename ?? null,
        extractedCommand: extraction.extractedCommand,
        extractedCommandSynonyms: extraction.extractedCommandSynonyms,
        extractedPattern: extraction.extractedPattern,
        extractedClassification: extraction.extractedClassification,
        extractedTopic: extraction.extractedTopic,
      })
      .returning();

    res.status(201).json(row);
  },
);

// PATCH /api/admin/reference-analyses/:id
// Body: { editedPattern?: string, editedClassification?: string, editedCommand?: string | null, editedCommandSynonyms?: string[] | null }
router.patch(
  "/admin/reference-analyses/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { editedPattern, editedClassification, editedCommand, editedCommandSynonyms } = req.body ?? {};

    const updates: Record<string, unknown> = {};
    if (typeof editedPattern === "string") updates.editedPattern = editedPattern;
    if (typeof editedClassification === "string") updates.editedClassification = editedClassification;
    if (editedCommand !== undefined) updates.editedCommand = typeof editedCommand === "string" ? editedCommand : null;
    if (editedCommandSynonyms !== undefined) {
      updates.editedCommandSynonyms = Array.isArray(editedCommandSynonyms)
        ? (editedCommandSynonyms as unknown[]).filter((s): s is string => typeof s === "string")
        : null;
    }
    updates.updatedAt = new Date().toISOString();

    const [row] = await db
      .update(referenceAnalysesTable)
      .set(updates as any)
      .where(eq(referenceAnalysesTable.id, id))
      .returning();

    if (!row) { res.status(404).json({ error: "Nicht gefunden" }); return; }
    res.json(row);
  },
);

// POST /api/admin/reference-analyses/:id/confirm
router.post(
  "/admin/reference-analyses/:id/confirm",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const [ref] = await db
      .select()
      .from(referenceAnalysesTable)
      .where(eq(referenceAnalysesTable.id, id))
      .limit(1);

    if (!ref) { res.status(404).json({ error: "Nicht gefunden" }); return; }
    if (ref.status === "confirmed") { res.status(409).json({ error: "Bereits bestätigt" }); return; }

    const pattern = ref.editedPattern ?? ref.extractedPattern;
    const classification = ref.editedClassification ?? ref.extractedClassification;

    if (!pattern.trim() || !classification.trim()) {
      res.status(400).json({ error: "Muster und Einstufungslogik dürfen nicht leer sein" });
      return;
    }

    // 1. Store to knowledge library
    let knowledgeDocId: string;
    try {
      knowledgeDocId = await confirmToKnowledge(
        id,
        pattern,
        classification,
        ref.extractedTopic,
        req.userId!,
      );
    } catch (err: unknown) {
      logger.error({ err, id }, "Wissenseintrag-Erstellung fehlgeschlagen");
      res.status(500).json({ error: "Wissenseintrag konnte nicht erstellt werden" });
      return;
    }

    // 2. Inject DairyComp synonyms if command was found (prefer edited values)
    const finalCommand = ref.editedCommand ?? ref.extractedCommand;
    const finalSynonyms = ref.editedCommandSynonyms ?? ref.extractedCommandSynonyms;
    if (finalCommand && finalSynonyms?.length) {
      try {
        await injectDairycompSynonyms(
          finalCommand,
          finalSynonyms,
          req.userId!,
        );
      } catch (err: unknown) {
        logger.warn({ err }, "DairyComp-Synonyme konnten nicht injiziert werden — Wissenseintrag trotzdem gespeichert");
      }
    }

    // 3. Mark as confirmed
    const [updated] = await db
      .update(referenceAnalysesTable)
      .set({ status: "confirmed", knowledgeDocId, updatedAt: new Date() } as any)
      .where(eq(referenceAnalysesTable.id, id))
      .returning();

    res.json(updated);
  },
);

// POST /api/admin/reference-analyses/:id/reextract
// Re-runs AI extraction with the current (updated) prompt on the stored rawInput.
// Only allowed on non-confirmed entries. Image-only submissions (empty rawInput)
// cannot be re-extracted here — user must re-upload the screenshot.
router.post(
  "/admin/reference-analyses/:id/reextract",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const [ref] = await db
      .select()
      .from(referenceAnalysesTable)
      .where(eq(referenceAnalysesTable.id, id))
      .limit(1);

    if (!ref) { res.status(404).json({ error: "Nicht gefunden" }); return; }
    if (ref.status === "confirmed") {
      res.status(409).json({ error: "Bereits bestätigt — Neu-Extraktion nicht möglich" });
      return;
    }
    if (!ref.rawInput?.trim()) {
      res.status(400).json({ error: "Kein gespeicherter Text — bitte Analyse erneut als Screenshot hochladen" });
      return;
    }

    let extraction: Awaited<ReturnType<typeof runExtraction>>;
    try {
      extraction = await runExtraction(ref.rawInput);
    } catch (err: unknown) {
      logger.error({ err, id }, "Re-Extraktion fehlgeschlagen");
      res.status(502).json({ error: "KI-Extraktion fehlgeschlagen — bitte erneut versuchen" });
      return;
    }

    const [updated] = await db
      .update(referenceAnalysesTable)
      .set({
        extractedCommand: extraction.extractedCommand,
        extractedCommandSynonyms: extraction.extractedCommandSynonyms,
        extractedPattern: extraction.extractedPattern,
        extractedClassification: extraction.extractedClassification,
        extractedTopic: extraction.extractedTopic,
        editedPattern: null,
        editedClassification: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(referenceAnalysesTable.id, id))
      .returning();

    res.json(updated);
  },
);

// POST /api/admin/reference-analyses/:id/reject
router.post(
  "/admin/reference-analyses/:id/reject",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const [row] = await db
      .update(referenceAnalysesTable)
      .set({ status: "rejected", updatedAt: new Date() } as any)
      .where(eq(referenceAnalysesTable.id, id))
      .returning();

    if (!row) { res.status(404).json({ error: "Nicht gefunden" }); return; }
    res.json(row);
  },
);

export default router;

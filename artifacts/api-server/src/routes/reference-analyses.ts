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
import objectStorage from "../lib/objectStorage";
import Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();
const anthropic = new Anthropic();

// ── Predefined topic list ─────────────────────────────────────────────────────
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

// ── DairyComp known-token dictionary ─────────────────────────────────────────
// Extracted from the DairyComp glossar knowledge document + standard field list.
// Used to validate OCR/AI-extracted field names in commands.
const KNOWN_DAIRYCOMP_TOKENS = new Set<string>([
  // Command keywords
  "LIST", "SUM", "SHOW", "GRAPH", "SORT", "EVENTS", "BREDSUM", "ENTER", "CHPEN",
  "FOR", "BY", "NOT", "AND", "EC", "REM", "OMIT", "FIND", "ADD", "MOVE", "MARK",
  // Core animal fields
  "ID", "PEN", "LACT", "DIM", "DDRY", "DCC", "SCC", "RC", "RPRO", "INMILK",
  "CDAT", "AGED", "GENDE", "RASSE", "EID", "INT", "HITAE", "BETRI", "SBRED",
  // Milk fields
  "MILK", "DMLK1", "DMLK2", "DMLK3", "DMLK4", "DMLK5", "DMLK6", "DMLK7",
  "WMLK1", "WMLK2", "WMLK3", "MDEV", "MDIFF", "MIDIF", "MCON", "MKDAT",
  "M1", "M2", "M3", "M4", "M5", "ME1", "ME2", "ME3", "WMLK", "DMLK",
  // Reproductive events
  "BRED", "PREG", "OPEN", "HEAT", "FRESH", "ABORT", "SOLD", "DIED", "MOVED",
  "DSLH", "DSLP", "DSLC", "DSLE", "DSBRED", "DAYOPEN", "DAYOPN",
  // BCS
  "BCS", "BCSV", "BC15", "BC30", "BC60", "BC120", "BC200", "BC300", "BC400",
  "BCSD15", "BCSD30", "BCSD60", "BCSD120", "BCSD200", "BCSD300", "BCSD400", "BCSDRY",
  // Identification / coding
  "SCODE", "SDESC", "VETC", "REG1", "HERD", "MODUE", "LCTGP", "PIT1", "PIT2",
  "AREA", "AR1", "AR2", "AR3", "AR4", "APEN",
  // Activity / sensor
  "ACTIV", "ACDAY", "ACTIM", "ACTITMS", "ACDAT", "ACLEV",
  // Date helpers
  "MKDAT", "KEDAT", "BDAT", "EDAT", "VDAT", "TDAT", "SYDAT", "CDES",
  // Misc common
  "DUE", "MUN", "ECM", "CUT", "TEMP", "NOTE", "NOTIZ",
  // Glossar-extracted (common ones from ALTER3 doc)
  "5STEL", "LMAST", "WDIFF", "MAST", "TEAT", "LAME", "LAHM", "RESP",
  "DSLP", "DXDAT", "DXLEV", "EASE", "EDAT",
]);

// Command/operator tokens that should never be flagged
const COMMAND_STOP_TOKENS = new Set<string>([
  "LIST", "SUM", "SHOW", "GRAPH", "SORT", "EVENTS", "BREDSUM", "ENTER",
  "FOR", "BY", "NOT", "AND", "OR",
]);

// ── Levenshtein distance ──────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Validate a DairyComp command string ───────────────────────────────────────
type TokenFlag = { token: string; status: "ok" | "uncertain" | "unknown"; suggestion?: string; distance?: number };

function validateDairyCompCommand(cmd: string | null): {
  confidence: "ok" | "uncertain";
  flags: TokenFlag[];
} {
  if (!cmd) return { confidence: "ok", flags: [] };

  // Extract uppercase alphabetic tokens (strip numbers, operators, backslashes)
  const rawTokens = cmd.toUpperCase().split(/[\s=<>!%\\\-+*/(){}\[\],"']+/);
  const tokens = rawTokens
    .map((t) => t.replace(/[^A-Z]/g, ""))
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));

  const flags: TokenFlag[] = [];
  let hasUncertain = false;

  for (const token of tokens) {
    if (KNOWN_DAIRYCOMP_TOKENS.has(token)) {
      flags.push({ token, status: "ok" });
      continue;
    }

    // Find closest known token
    let bestDist = Infinity;
    let bestMatch = "";
    for (const known of KNOWN_DAIRYCOMP_TOKENS) {
      // Only compare tokens of similar length (± 2 chars) for performance
      if (Math.abs(known.length - token.length) > 2) continue;
      const d = levenshtein(token, known);
      if (d < bestDist) {
        bestDist = d;
        bestMatch = known;
      }
    }

    if (bestDist === 0) {
      flags.push({ token, status: "ok" });
    } else if (bestDist <= 2) {
      flags.push({ token, status: "uncertain", suggestion: bestMatch, distance: bestDist });
      hasUncertain = true;
    } else {
      flags.push({ token, status: "unknown" });
      hasUncertain = true;
    }
  }

  return { confidence: hasUncertain ? "uncertain" : "ok", flags };
}

// ── Extraction prompt ─────────────────────────────────────────────────────────
const EXTRACTION_SYSTEM_PROMPT = `Du bist ein Milchwirtschafts-Experte und destillierst aus konkreten Analysebeispielen allgemeingültige Interpretationsmuster für andere Betriebe.

ABSOLUTES VERBOT: Die extrahierten Texte dürfen KEINE konkreten Zahlen, Prozentwerte, Schwellenwerte oder betriebsspezifischen Messwerte aus dem Eingabebeispiel enthalten. Das Muster muss universell anwendbar sein.

${SHARED_TERMINOLOGY_RULES}

${SHARED_DERIVATION_PROHIBITION}

Deine Aufgabe:

1. DAIRYCOMP-BEFEHL (optional): Falls im Text ein DairyComp 305-Befehl erkennbar ist (LIST, SUM, EVENTS, SORT, GRAPH, BREDSUM\\E o.ä.), extrahiere ihn exakt (extractedCommand) und erstelle 4–6 deutsche Klartext-Synonyme, die beschreiben was der Befehl ausgibt (extractedCommandSynonyms). Achte dabei auf die Terminologie-Trennregel: BREDSUM\\E gibt die Pregnancy Rate aus — die Spalte "Preg/Bred" darin ist die Konzeptionsrate. Synonyme müssen diese Unterscheidung korrekt widerspiegeln. Wenn kein Befehl erkennbar ist, setze beide Felder auf null.

WICHTIG für Befehlserkennung: Lies jeden Buchstaben eines Feldnamens einzeln ab. DairyComp-Felder sind case-sensitiv und oft kurze Abkürzungen (z.B. DDRY = Days Dry, DIM = Days in Milk, DMLK1 = Daily Milk 1). Schreibe den erkannten Befehl exakt so auf, wie er im Bild/Text erscheint.

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

// ── Helper: run extraction TWICE and compare commands ─────────────────────────
async function runDoublePassExtraction(
  textContent: string,
  imageBase64?: string,
  imageMimeType?: string,
): Promise<{
  extraction: Awaited<ReturnType<typeof runExtraction>>;
  commandAlternative: string | null;
}> {
  // Always run first pass
  const first = await runExtraction(textContent, imageBase64, imageMimeType);

  // Only run second pass if image was provided (OCR is where errors occur)
  if (!imageBase64) {
    return { extraction: first, commandAlternative: null };
  }

  let second: Awaited<ReturnType<typeof runExtraction>>;
  try {
    second = await runExtraction(textContent, imageBase64, imageMimeType);
  } catch (err) {
    logger.warn({ err }, "Zweiter Extraktionsdurchgang fehlgeschlagen — verwende ersten");
    return { extraction: first, commandAlternative: null };
  }

  // Compare the two commands
  const cmd1 = first.extractedCommand?.trim() ?? null;
  const cmd2 = second.extractedCommand?.trim() ?? null;

  if (cmd1 === cmd2) {
    return { extraction: first, commandAlternative: null };
  }

  // They differ — return first extraction but note the alternative
  logger.info({ cmd1, cmd2 }, "Befehl-Extraktion: Abweichung zwischen erstem und zweitem Durchgang");
  return { extraction: first, commandAlternative: cmd2 };
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

// GET /api/admin/reference-analyses/:id/image
// Serves the stored screenshot from object storage
router.get(
  "/admin/reference-analyses/:id/image",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const [ref] = await db
      .select({ imageObjectPath: referenceAnalysesTable.imageObjectPath })
      .from(referenceAnalysesTable)
      .where(eq(referenceAnalysesTable.id, id))
      .limit(1);

    if (!ref) { res.status(404).json({ error: "Nicht gefunden" }); return; }
    if (!ref.imageObjectPath) { res.status(404).json({ error: "Kein Bild gespeichert" }); return; }

    try {
      const file = await objectStorage.getObjectEntityFile(ref.imageObjectPath);
      const contentType = ref.imageObjectPath.endsWith(".png") ? "image/png"
        : ref.imageObjectPath.endsWith(".webp") ? "image/webp"
        : "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=86400");
      if (file.stream) {
        file.stream.pipe(res);
      } else if (file.buffer) {
        res.send(file.buffer);
      } else {
        res.status(500).json({ error: "Bild nicht lesbar" });
      }
    } catch (err: unknown) {
      logger.error({ err, id }, "Referenzanalyse-Bild konnte nicht geladen werden");
      res.status(404).json({ error: "Bild nicht verfügbar" });
    }
  },
);

// POST /api/admin/reference-analyses
// Body: { rawText?, adminNote?, imageBase64?, imageMimeType?, uploadFilename? }
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

    // Run double-pass extraction
    let doublePass: Awaited<ReturnType<typeof runDoublePassExtraction>>;
    try {
      doublePass = await runDoublePassExtraction(rawInput, imageBase64, imageMimeType);
    } catch (err: unknown) {
      logger.error({ err }, "Referenzanalyse-Extraktion fehlgeschlagen");
      res.status(502).json({ error: "KI-Extraktion fehlgeschlagen — bitte erneut versuchen" });
      return;
    }

    const { extraction, commandAlternative } = doublePass;

    // Validate the extracted command
    const validation = validateDairyCompCommand(extraction.extractedCommand);

    // If second pass found a different command, also validate that and pick uncertain if needed
    let finalConfidence = validation.confidence;
    if (commandAlternative !== null) {
      finalConfidence = "uncertain";
    }

    // Store image in object storage if provided
    let imageObjectPath: string | null = null;
    if (imageBase64) {
      try {
        const imgBuf = Buffer.from(imageBase64, "base64");
        const ext = imageMimeType?.includes("png") ? "png"
          : imageMimeType?.includes("webp") ? "webp"
          : "jpg";
        const subpath = `reference-analyses/screenshots/${randomUUID()}.${ext}`;
        imageObjectPath = await objectStorage.uploadBytesAsEntity(subpath, imgBuf, imageMimeType ?? "image/jpeg");
      } catch (err: unknown) {
        logger.warn({ err }, "Bild konnte nicht in Object-Storage gespeichert werden — wird ohne Bild fortgefahren");
      }
    }

    const [row] = await db
      .insert(referenceAnalysesTable)
      .values({
        adminUserId: req.userId!,
        status: "pending_review",
        rawInput,
        adminNote: adminNote ?? null,
        uploadFilename: uploadFilename ?? null,
        imageObjectPath,
        extractedCommand: extraction.extractedCommand,
        extractedCommandSynonyms: extraction.extractedCommandSynonyms,
        extractedPattern: extraction.extractedPattern,
        extractedClassification: extraction.extractedClassification,
        extractedTopic: extraction.extractedTopic,
        commandConfidence: finalConfidence,
        commandAlternative: commandAlternative ?? null,
        commandFlags: validation.flags.length > 0 ? validation.flags : null,
      })
      .returning();

    res.status(201).json(row);
  },
);

// PATCH /api/admin/reference-analyses/:id
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
    if (editedCommand !== undefined) {
      const cmd = typeof editedCommand === "string" ? editedCommand.trim() || null : null;
      updates.editedCommand = cmd;
      // Re-validate the edited command
      if (cmd) {
        const v = validateDairyCompCommand(cmd);
        updates.commandConfidence = v.confidence;
        updates.commandFlags = v.flags.length > 0 ? v.flags : null;
        updates.commandAlternative = null; // user manually corrected, clear divergence
      }
    }
    if (editedCommandSynonyms !== undefined) {
      updates.editedCommandSynonyms = Array.isArray(editedCommandSynonyms)
        ? (editedCommandSynonyms as unknown[]).filter((s): s is string => typeof s === "string")
        : null;
    }
    updates.updatedAt = new Date();

    let row: typeof referenceAnalysesTable.$inferSelect | undefined;
    try {
      const result = await db
        .update(referenceAnalysesTable)
        .set(updates as any)
        .where(eq(referenceAnalysesTable.id, id))
        .returning();
      row = result[0];
    } catch (err: unknown) {
      logger.error({ err, id, updates: Object.keys(updates) }, "PATCH reference-analysis fehlgeschlagen");
      res.status(500).json({ error: "Speichern fehlgeschlagen — bitte erneut versuchen" });
      return;
    }

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

    // Re-extract from stored text only (image is in object storage but not re-sent here)
    let extraction: Awaited<ReturnType<typeof runExtraction>>;
    try {
      extraction = await runExtraction(ref.rawInput);
    } catch (err: unknown) {
      logger.error({ err, id }, "Re-Extraktion fehlgeschlagen");
      res.status(502).json({ error: "KI-Extraktion fehlgeschlagen — bitte erneut versuchen" });
      return;
    }

    const validation = validateDairyCompCommand(extraction.extractedCommand);

    const [updated] = await db
      .update(referenceAnalysesTable)
      .set({
        extractedCommand: extraction.extractedCommand,
        extractedCommandSynonyms: extraction.extractedCommandSynonyms,
        extractedPattern: extraction.extractedPattern,
        extractedClassification: extraction.extractedClassification,
        extractedTopic: extraction.extractedTopic,
        commandConfidence: validation.confidence,
        commandFlags: validation.flags.length > 0 ? validation.flags : null,
        commandAlternative: null,
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

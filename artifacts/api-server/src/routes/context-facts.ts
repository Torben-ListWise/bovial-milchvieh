import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  datasetsTable,
  analysesTable,
  contextFactsTable,
  type ContextFact,
} from "@workspace/db";
import {
  ListContextFactsParams,
  ListContextFactsResponse,
  CorrectContextFactParams,
  CorrectContextFactBody,
  CorrectContextFactResponse,
  ConfirmContextFactParams,
  ConfirmContextFactBody,
  ConfirmContextFactResponse,
  RejectContextFactParams,
  RejectContextFactResponse,
  DeactivateContextFactParams,
  DeactivateContextFactResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { canReadDataset } from "../lib/teamAccess";
import { logger } from "../lib/logger";
import { embedTexts } from "../lib/embeddings";

const DEDUP_SIMILARITY_THRESHOLD = 0.88;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

const router: IRouter = Router();

const CATEGORIES = ["verfahren", "ausruestung", "wartezeiten", "sonstiges"] as const;

async function serializeFact(f: ContextFact) {
  let sourceAnalysisExists = false;
  if (f.sourceAnalysisId) {
    const [a] = await db
      .select({ id: analysesTable.id })
      .from(analysesTable)
      .where(eq(analysesTable.id, f.sourceAnalysisId));
    sourceAnalysisExists = !!a;
  }
  return {
    id: f.id,
    datasetId: f.datasetId,
    category: (CATEGORIES as readonly string[]).includes(f.category)
      ? (f.category as (typeof CATEGORIES)[number])
      : "sonstiges",
    factText: f.factText,
    originalText: f.originalText,
    status: f.status as "vorgeschlagen" | "aktiv" | "abgelehnt" | "deaktiviert",
    sourceAnalysisId: f.sourceAnalysisId ?? null,
    sourceMessageId: f.sourceMessageId ?? null,
    sourceAnalysisExists,
    confirmedBy: f.confirmedBy ?? null,
    confirmedAt: f.confirmedAt ?? null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

async function ownDataset(datasetId: string, userId: string): Promise<boolean> {
  const [d] = await db
    .select({ id: datasetsTable.id })
    .from(datasetsTable)
    .where(and(eq(datasetsTable.id, datasetId), eq(datasetsTable.userId, userId)));
  return !!d;
}

// Fetches the fact and verifies the requesting user owns the underlying dataset
// (guests are strictly read-only — see task decision).
async function ownedFact(factId: string, userId: string): Promise<ContextFact | null> {
  const [f] = await db.select().from(contextFactsTable).where(eq(contextFactsTable.id, factId));
  if (!f) return null;
  if (!(await ownDataset(f.datasetId, userId))) return null;
  return f;
}

router.get(
  "/datasets/:datasetId/context-facts",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = ListContextFactsParams.parse(req.params);
    if (!(await canReadDataset(datasetId, req.userId!))) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }
    const rows = await db
      .select()
      .from(contextFactsTable)
      .where(eq(contextFactsTable.datasetId, datasetId))
      .orderBy(desc(contextFactsTable.createdAt));
    // Rejected/deactivated facts are kept in the DB (for dedup + audit) but are
    // not shown in the UI list beyond active + pending suggestions.
    const visible = rows.filter((r) => r.status === "vorgeschlagen" || r.status === "aktiv");
    res.json(ListContextFactsResponse.parse(await Promise.all(visible.map(serializeFact))));
  },
);

router.patch("/context-facts/:contextFactId", requireAuth, async (req: Request, res: Response) => {
  const { contextFactId } = CorrectContextFactParams.parse(req.params);
  const parsed = CorrectContextFactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  const existing = await ownedFact(contextFactId, req.userId!);
  if (!existing) {
    res.status(404).json({ error: "Betriebs-Kontext-Fakt nicht gefunden" });
    return;
  }
  if (existing.status !== "vorgeschlagen") {
    res.status(400).json({ error: "Nur Vorschläge können korrigiert werden" });
    return;
  }

  // Re-run the dedup check against already-active facts of the same dataset so
  // a correction cannot accidentally duplicate a fact that is already active.
  // Fail-open: if embedding fails, the correction proceeds unchecked.
  let duplicateOfActive = false;
  try {
    const [correctedEmbedding] = await embedTexts([parsed.data.factText]);
    const activeFacts = await db
      .select({ embedding: contextFactsTable.embedding })
      .from(contextFactsTable)
      .where(and(eq(contextFactsTable.datasetId, existing.datasetId), eq(contextFactsTable.status, "aktiv")));
    duplicateOfActive = activeFacts.some(
      (f) => f.embedding && cosineSimilarity(correctedEmbedding, f.embedding) >= DEDUP_SIMILARITY_THRESHOLD,
    );
  } catch (err) {
    logger.warn({ err, contextFactId }, "Dedup-Prüfung bei Korrektur fehlgeschlagen — fahre ungeprüft fort");
  }

  if (duplicateOfActive) {
    const [updated] = await db
      .update(contextFactsTable)
      .set({ status: "abgelehnt", factText: parsed.data.factText, updatedAt: new Date() })
      .where(eq(contextFactsTable.id, contextFactId))
      .returning();
    logger.info({ contextFactId, datasetId: existing.datasetId }, "Korrektur dupliziert aktiven Fakt — automatisch abgelehnt");
    res.status(409).json({ error: "Dieser Fakt ist bereits als aktiv bestätigt", fact: await serializeFact(updated) });
    return;
  }

  const [updated] = await db
    .update(contextFactsTable)
    .set({ factText: parsed.data.factText, updatedAt: new Date() })
    .where(eq(contextFactsTable.id, contextFactId))
    .returning();
  res.json(CorrectContextFactResponse.parse(await serializeFact(updated)));
});

router.post("/context-facts/:contextFactId/confirm", requireAuth, async (req: Request, res: Response) => {
  const { contextFactId } = ConfirmContextFactParams.parse(req.params);
  const parsed = ConfirmContextFactBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  const existing = await ownedFact(contextFactId, req.userId!);
  if (!existing) {
    res.status(404).json({ error: "Betriebs-Kontext-Fakt nicht gefunden" });
    return;
  }
  if (existing.status !== "vorgeschlagen") {
    res.status(400).json({ error: "Nur Vorschläge können bestätigt werden" });
    return;
  }

  const finalText = parsed.data.factText ?? existing.factText;

  // If the confirm call also edits the text inline, re-run the dedup check
  // against already-active facts for the same reason as the correct endpoint.
  if (parsed.data.factText && parsed.data.factText !== existing.factText) {
    try {
      const [correctedEmbedding] = await embedTexts([finalText]);
      const activeFacts = await db
        .select({ embedding: contextFactsTable.embedding })
        .from(contextFactsTable)
        .where(and(eq(contextFactsTable.datasetId, existing.datasetId), eq(contextFactsTable.status, "aktiv")));
      const duplicateOfActive = activeFacts.some(
        (f) => f.embedding && cosineSimilarity(correctedEmbedding, f.embedding) >= DEDUP_SIMILARITY_THRESHOLD,
      );
      if (duplicateOfActive) {
        const [updated] = await db
          .update(contextFactsTable)
          .set({ status: "abgelehnt", factText: finalText, updatedAt: new Date() })
          .where(eq(contextFactsTable.id, contextFactId))
          .returning();
        res.status(409).json({ error: "Dieser Fakt ist bereits als aktiv bestätigt", fact: await serializeFact(updated) });
        return;
      }
    } catch (err) {
      logger.warn({ err, contextFactId }, "Dedup-Prüfung bei Bestätigung fehlgeschlagen — fahre ungeprüft fort");
    }
  }

  const [updated] = await db
    .update(contextFactsTable)
    .set({
      status: "aktiv",
      factText: finalText,
      confirmedBy: req.userId!,
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(contextFactsTable.id, contextFactId))
    .returning();
  logger.info({ factId: contextFactId, datasetId: existing.datasetId }, "Betriebs-Kontext-Fakt bestätigt");
  res.json(ConfirmContextFactResponse.parse(await serializeFact(updated)));
});

router.post("/context-facts/:contextFactId/reject", requireAuth, async (req: Request, res: Response) => {
  const { contextFactId } = RejectContextFactParams.parse(req.params);
  const existing = await ownedFact(contextFactId, req.userId!);
  if (!existing) {
    res.status(404).json({ error: "Betriebs-Kontext-Fakt nicht gefunden" });
    return;
  }
  if (existing.status !== "vorgeschlagen") {
    res.status(400).json({ error: "Nur Vorschläge können abgelehnt werden" });
    return;
  }
  const [updated] = await db
    .update(contextFactsTable)
    .set({ status: "abgelehnt", updatedAt: new Date() })
    .where(eq(contextFactsTable.id, contextFactId))
    .returning();
  res.json(RejectContextFactResponse.parse(await serializeFact(updated)));
});

router.post("/context-facts/:contextFactId/deactivate", requireAuth, async (req: Request, res: Response) => {
  const { contextFactId } = DeactivateContextFactParams.parse(req.params);
  const existing = await ownedFact(contextFactId, req.userId!);
  if (!existing) {
    res.status(404).json({ error: "Betriebs-Kontext-Fakt nicht gefunden" });
    return;
  }
  if (existing.status !== "aktiv") {
    res.status(400).json({ error: "Nur aktive Fakten können deaktiviert werden" });
    return;
  }
  const [updated] = await db
    .update(contextFactsTable)
    .set({ status: "deaktiviert", updatedAt: new Date() })
    .where(eq(contextFactsTable.id, contextFactId))
    .returning();
  res.json(DeactivateContextFactResponse.parse(await serializeFact(updated)));
});

export default router;

import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { startDunningScheduler } from "./lib/dunning";
import { startDigestScheduler } from "./lib/digestScheduler";
import { startNewsScheduler } from "./lib/newsWeeklyBatch";
import { startThiScheduler } from "./lib/thi";
import { startChipScheduler } from "./lib/chipScheduler";
import { ensureExtensions, setupAnalystSandbox, pool, db, knowledgeDocumentsTable, analysesTable, messagesTable } from "@workspace/db";
import { and, eq, isNull, isNotNull, ne, or, desc } from "drizzle-orm";
import { ingestKnowledgeDoc } from "./lib/ingest";
import { seedSystemKnowledge } from "./lib/seedKnowledge";
import { warmupEmbeddingModel, embeddingModelReady, LOCAL_MODEL_NAME } from "./lib/embeddings";
import { attachWebSocketServer } from "./lib/wsHandler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Re-embed all documents whose embedding_model differs from the current local
 * model (NULL = old Gemini, or a different version). Atomic per document:
 *   1. Drop HNSW index (prevents index corruption mid-migration)
 *   2. For each legacy doc: ingestKnowledgeDoc() handles delete→embed→insert→set_model
 *   3. Recreate HNSW index once at the end
 *
 * Restart-safe: includes docs left in 'processing' state by a previous interrupted
 * migration run (embedding_model still wrong/null). ingestKnowledgeDoc() will
 * re-process them fully — delete stale chunks, re-embed, insert, set embedding_model.
 */
async function reembedLegacyDocs(): Promise<void> {
  try {
    const legacy = await db
      .select({
        id: knowledgeDocumentsTable.id,
        title: knowledgeDocumentsTable.title,
      })
      .from(knowledgeDocumentsTable)
      .where(
        and(
          // Include 'ready' (normal) AND 'processing' (interrupted mid-migration)
          or(
            eq(knowledgeDocumentsTable.status, "ready"),
            eq(knowledgeDocumentsTable.status, "processing"),
          ),
          or(
            isNull(knowledgeDocumentsTable.embeddingModel),
            ne(knowledgeDocumentsTable.embeddingModel, LOCAL_MODEL_NAME),
          ),
        ),
      );

    if (legacy.length === 0) {
      logger.info("Re-Embedding: alle Dokumente sind bereits mit dem lokalen Modell eingebettet");
      return;
    }

    logger.info(
      { count: legacy.length, model: LOCAL_MODEL_NAME },
      "Re-Embedding: starte Migration alter Dokumente",
    );

    // 1. Drop HNSW index so inserts are fast and index stays consistent
    await pool.query("DROP INDEX IF EXISTS knowledge_chunks_embedding_hnsw_idx");
    logger.info("Re-Embedding: HNSW-Index entfernt");

    // 2. Re-embed each doc atomically (delete old chunks → embed → insert → set embeddingModel)
    for (const doc of legacy) {
      logger.info({ id: doc.id, title: doc.title }, "Re-Embedding: Dokument startet");
      try {
        await ingestKnowledgeDoc(doc.id);
        logger.info({ id: doc.id, title: doc.title }, "Re-Embedding: Dokument abgeschlossen");
      } catch (err) {
        logger.warn({ id: doc.id, err }, "Re-Embedding: Dokument fehlgeschlagen — weiter mit nächstem");
      }
    }

    // 3. Recreate HNSW index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
      ON knowledge_chunks
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `);
    logger.info("Re-Embedding: HNSW-Index neu erstellt — Migration abgeschlossen");
  } catch (err) {
    logger.warn({ err }, "reembedLegacyDocs fehlgeschlagen");
  }
}

async function resumePendingIngestions() {
  try {
    // Re-ingest both "pending" docs (interrupted before start) and "error" docs
    // (failed on a previous run — e.g. due to wrong model-cache path that is now fixed).
    const docs = await db
      .select({ id: knowledgeDocumentsTable.id, title: knowledgeDocumentsTable.title, status: knowledgeDocumentsTable.status })
      .from(knowledgeDocumentsTable)
      .where(or(
        eq(knowledgeDocumentsTable.status, "pending"),
        eq(knowledgeDocumentsTable.status, "error"),
      ));
    if (docs.length === 0) return;
    logger.info({ count: docs.length }, "Starte Ingestion für ausstehende/fehlerhafte Dokumente (sequenziell)");
    for (const doc of docs) {
      logger.info({ id: doc.id, title: doc.title, status: doc.status }, "Ingestion gestartet");
      try {
        await ingestKnowledgeDoc(doc.id);
        logger.info({ id: doc.id, title: doc.title }, "Ingestion abgeschlossen");
      } catch (err) {
        logger.warn({ id: doc.id, err }, "Ingestion fehlgeschlagen — nächstes Dokument");
      }
    }
  } catch (err) {
    logger.warn({ err }, "resumePendingIngestions fehlgeschlagen");
  }
}

// On server start, find any analyses whose agentProgress was left non-null by a
// previous run that was killed mid-flight (e.g. a Replit dev-reload). For each:
//   - If the analysis already has an assistant message after the last user message,
//     the agent finished but the DB-clear in the finally block never ran → just
//     clear agentProgress, no error message needed.
//   - Otherwise the agent was genuinely interrupted → clear agentProgress and
//     insert a clear error message so the user sees it instead of an endless spinner.
async function clearOrphanedAnalyses() {
  try {
    const orphans = await db
      .select({ id: analysesTable.id })
      .from(analysesTable)
      .where(isNotNull(analysesTable.agentProgress));

    if (orphans.length === 0) return;

    logger.info({ count: orphans.length }, "Bereinige verwaiste Analysen (agentProgress hängt)");

    for (const { id } of orphans) {
      try {
        const [lastMsg] = await db
          .select({ role: messagesTable.role })
          .from(messagesTable)
          .where(eq(messagesTable.analysisId, id))
          .orderBy(desc(messagesTable.createdAt))
          .limit(1);

        await db
          .update(analysesTable)
          .set({ agentProgress: null, agentSteps: [] } as any)
          .where(eq(analysesTable.id, id));

        if (lastMsg?.role === "assistant") {
          logger.info({ id }, "Verwaiste Analyse: agentProgress geleert (Antwort bereits vorhanden)");
        } else {
          await db.insert(messagesTable).values({
            analysisId: id,
            role: "assistant",
            content: "Die Analyse wurde durch einen Server-Neustart unterbrochen. Bitte stelle deine Frage erneut.",
            error: "Server-Neustart während der Analyse",
          } as any);
          logger.info({ id }, "Verwaiste Analyse: Fehlermeldung eingefügt");
        }
      } catch (err) {
        logger.warn({ id, err }, "Fehler beim Bereinigen verwaister Analyse");
      }
    }
  } catch (err) {
    logger.warn({ err }, "clearOrphanedAnalyses fehlgeschlagen");
  }
}

ensureExtensions()
  .then(async () => {
    // Set up the DB-level security sandbox for run_sql (idempotent)
    await setupAnalystSandbox();
    logger.info("Analyst sandbox (milchvieh_analyst role + RLS) bereit");

    const httpServer = createServer(app);
    attachWebSocketServer(httpServer);

    httpServer.listen(port, (err?: Error) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");

      if (process.env.GOOGLE_API_KEY) {
        logger.info("GOOGLE_API_KEY ist gesetzt, wird nicht mehr für Embeddings verwendet (lokales Modell aktiv)");
      }

      startScheduler();
      startDunningScheduler();
      startDigestScheduler();
      startNewsScheduler();
      startThiScheduler();
      startChipScheduler();
      void clearOrphanedAnalyses();

      // Warm up the embedding model in the background so the health check
      // passes immediately. The first embedding request pays the ONNX
      // cold-start penalty only if warmup hasn't finished yet.
      void warmupEmbeddingModel()
        .then(() => seedSystemKnowledge())
        .then(() => reembedLegacyDocs())
        .then(() => resumePendingIngestions())
        .catch((err) => logger.error({ err }, "Post-Startup-Ingestion fehlgeschlagen"));
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to ensure DB extensions — exiting");
    process.exit(1);
  });

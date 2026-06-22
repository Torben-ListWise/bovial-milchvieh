import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureExtensions, pool, db, knowledgeDocumentsTable, analysesTable, messagesTable } from "@workspace/db";
import { and, eq, isNull, isNotNull, ne, or, desc } from "drizzle-orm";
import { ingestKnowledgeDoc } from "./lib/ingest";
import { warmupEmbeddingModel, embeddingModelReady, LOCAL_MODEL_NAME } from "./lib/embeddings";

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
 * A server restart mid-migration is safe — docs with the wrong/missing
 * embedding_model will simply be re-processed on the next startup.
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
          eq(knowledgeDocumentsTable.status, "ready"),
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
    const pending = await db
      .select({ id: knowledgeDocumentsTable.id, title: knowledgeDocumentsTable.title })
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.status, "pending"));
    if (pending.length === 0) return;
    logger.info({ count: pending.length }, "Starte Ingestion für ausstehende Dokumente (sequenziell)");
    for (const doc of pending) {
      logger.info({ id: doc.id, title: doc.title }, "Ingestion gestartet");
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
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");

      if (process.env.GOOGLE_API_KEY) {
        logger.info("GOOGLE_API_KEY ist gesetzt, wird nicht mehr für Embeddings verwendet (lokales Modell aktiv)");
      }

      startScheduler();
      void clearOrphanedAnalyses();

      // Load local embedding model in background, then migrate legacy docs and
      // run any pending ingestions. Server is already accepting requests.
      void warmupEmbeddingModel()
        .then(() => reembedLegacyDocs())
        .then(() => resumePendingIngestions())
        .catch((err) => logger.error({ err }, "Embedding-Startup fehlgeschlagen"));
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to ensure DB extensions — exiting");
    process.exit(1);
  });

import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureExtensions, db, knowledgeDocumentsTable, analysesTable, messagesTable } from "@workspace/db";
import { and, eq, isNull, isNotNull, ne, or, desc } from "drizzle-orm";
import { ingestKnowledgeDoc } from "./lib/ingest";
import { warmupEmbeddingModel, LOCAL_MODEL_NAME } from "./lib/embeddings";

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
 * Mark all 'ready' documents that were embedded with the old Gemini model
 * (embeddingModel IS NULL) as 'pending' so they get re-embedded with the
 * local model on the next resumePendingIngestions() call.
 */
async function markLegacyDocsForReembedding(): Promise<void> {
  try {
    // Find 'ready' docs where embeddingModel IS NULL (old Gemini API) or differs from local model
    const toMigrate = await db
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

    if (toMigrate.length === 0) {
      logger.info("Alle Dokumente sind bereits mit dem lokalen Modell eingebettet");
      return;
    }

    logger.info(
      { count: toMigrate.length, model: LOCAL_MODEL_NAME },
      "Re-Embedding: Setze veraltete Dokumente auf 'pending'",
    );

    for (const doc of toMigrate) {
      await db
        .update(knowledgeDocumentsTable)
        .set({ status: "pending" })
        .where(eq(knowledgeDocumentsTable.id, doc.id));
    }

    logger.info(
      { count: toMigrate.length },
      "Re-Embedding: Dokumente bereit für Neu-Einbettung",
    );
  } catch (err) {
    logger.warn({ err }, "markLegacyDocsForReembedding fehlgeschlagen");
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
        // Get the last message for this analysis
        const [lastMsg] = await db
          .select({ role: messagesTable.role })
          .from(messagesTable)
          .where(eq(messagesTable.analysisId, id))
          .orderBy(desc(messagesTable.createdAt))
          .limit(1);

        // Clear agentProgress in all cases
        await db
          .update(analysesTable)
          .set({ agentProgress: null, agentSteps: [] } as any)
          .where(eq(analysesTable.id, id));

        if (lastMsg?.role === "assistant") {
          // Agent completed but the finally-block DB-clear never ran — no error needed
          logger.info({ id }, "Verwaiste Analyse: agentProgress geleert (Antwort bereits vorhanden)");
        } else {
          // Agent was interrupted mid-run — insert a visible error message
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
      startScheduler();
      void clearOrphanedAnalyses();

      // Load local embedding model in background, then migrate legacy docs and
      // run any pending ingestions. Server is already accepting requests.
      void warmupEmbeddingModel()
        .then(() => markLegacyDocsForReembedding())
        .then(() => resumePendingIngestions())
        .catch((err) => logger.error({ err }, "Embedding-Startup fehlgeschlagen"));
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to ensure DB extensions — exiting");
    process.exit(1);
  });

import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureExtensions, db, knowledgeDocumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ingestKnowledgeDoc } from "./lib/ingest";

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
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (err) {
    logger.warn({ err }, "resumePendingIngestions fehlgeschlagen");
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
      void resumePendingIngestions();
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to ensure DB extensions — exiting");
    process.exit(1);
  });

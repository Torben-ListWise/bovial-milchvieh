/**
 * Retry embedding for docs that scraped successfully (size > 0) but timed out during ingest.
 */
import { eq, and, isNotNull, gt, sql } from "drizzle-orm";
import { db, knowledgeDocumentsTable } from "@workspace/db";
import { ingestKnowledgeDoc } from "../lib/ingest";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Find docs with source_url, status=error (or processing), and size > 0
  const docs = await db
    .select({ id: knowledgeDocumentsTable.id, title: knowledgeDocumentsTable.title, status: knowledgeDocumentsTable.status })
    .from(knowledgeDocumentsTable)
    .where(
      and(
        isNotNull(knowledgeDocumentsTable.sourceUrl),
        gt(knowledgeDocumentsTable.size, 0),
      )
    );

  const toRetry = docs.filter(d => d.status === "error" || d.status === "processing");
  console.log(`Re-embedding ${toRetry.length} Dokumente …\n`);

  for (const doc of toRetry) {
    console.log(`[EMBED] ${doc.title} (${doc.id})`);
    await db
      .update(knowledgeDocumentsTable)
      .set({ status: "processing", errorMessage: null })
      .where(eq(knowledgeDocumentsTable.id, doc.id));
    try {
      await ingestKnowledgeDoc(doc.id);
      console.log(`[DONE]  ${doc.title}`);
    } catch (err) {
      console.error(`[FAIL]  ${doc.title} → ${err instanceof Error ? err.message : err}`);
    }
    // Pause between docs to avoid rate-limit cascades
    await sleep(5000);
  }

  console.log("\nFertig.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });

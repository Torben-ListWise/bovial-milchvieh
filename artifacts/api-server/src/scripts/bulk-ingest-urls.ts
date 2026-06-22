/**
 * Bulk URL ingestion script — parallel with per-URL timeout.
 * Usage: pnpm tsx src/scripts/bulk-ingest-urls.ts [groupIndex]
 *   groupIndex 0 = URLs 0-5, 1 = URLs 6-11 (default: all)
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, knowledgeDocumentsTable } from "@workspace/db";
import { scrapeUrl, canonicalizeUrl } from "../lib/scraper";
import { ingestKnowledgeDoc } from "../lib/ingest";
import { ObjectStorageService } from "../lib/objectStorage";

const objectStorage = new ObjectStorageService();

const ALL_URLS = [
  // Group 0 (index 0-5): Rohdaten + Fachnachrichten
  "https://www.fao.org/faostat/en/",
  "https://www.nass.usda.gov",
  "https://www.usda.gov/oce/commodity/wasde",
  "https://www.agri-outlook.org",
  "https://www.agweb.com",
  "https://www.fwi.co.uk",
  // Group 1 (index 6-11): Fachnachrichten + Milchvieh
  "https://www.producer.com",
  "https://www.dtnpf.com",
  "https://www.agri-pulse.com",
  "https://ifcndairy.org",
  "https://www.rabobank.com/knowledge/q011495758-global-dairy-top-20-subtle-shifts-for-2025-but-a-shake-up-expected-for-2026",
  "https://hoards.com",
];

const groupArg = process.argv[2];
let URLS: string[];
if (groupArg === "0") {
  URLS = ALL_URLS.slice(0, 6);
} else if (groupArg === "1") {
  URLS = ALL_URLS.slice(6);
} else {
  URLS = ALL_URLS;
}

const PER_URL_TIMEOUT_MS = 90_000;
const CONCURRENCY = 3;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout nach ${ms / 1000}s: ${label}`)), ms),
    ),
  ]);
}

async function ingestOne(rawUrl: string): Promise<void> {
  const canonical = canonicalizeUrl(rawUrl);
  const parsedUrl = new URL(rawUrl);

  // Dedup check
  const existing = await db
    .select({ id: knowledgeDocumentsTable.id })
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.sourceUrl, canonical))
    .limit(1);
  if (existing.length > 0) {
    console.log(`[SKIP]  ${rawUrl}  (bereits vorhanden)`);
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
      sourceUrl: canonical,
      uploadedBy: "system-bulk-ingest",
    })
    .returning();

  console.log(`[START] ${rawUrl}  (docId: ${doc.id})`);

  try {
    await withTimeout(
      (async () => {
        const scraped = await scrapeUrl(rawUrl);
        const buf = Buffer.from(scraped.text, "utf-8");
        const objectPath = await objectStorage.uploadBytesAsEntity(placeholder, buf, "text/plain");
        await db
          .update(knowledgeDocumentsTable)
          .set({ title: scraped.title || parsedUrl.hostname, objectPath, size: buf.length })
          .where(eq(knowledgeDocumentsTable.id, doc.id));
        await ingestKnowledgeDoc(doc.id);
        console.log(`[DONE]  ${rawUrl}  (${scraped.pageCount} Seiten, ${buf.length} Bytes)`);
      })(),
      PER_URL_TIMEOUT_MS,
      rawUrl,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL]  ${rawUrl}  → ${msg}`);
    await db
      .update(knowledgeDocumentsTable)
      .set({ status: "error", errorMessage: msg })
      .where(eq(knowledgeDocumentsTable.id, doc.id));
  }
}

async function runConcurrent(urls: string[], limit: number): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const url = urls[idx++];
      await ingestOne(url);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, () => worker()));
}

async function main() {
  console.log(`\nBulk-Ingestion von ${URLS.length} URLs (Concurrency: ${CONCURRENCY}) …\n`);
  await runConcurrent(URLS, CONCURRENCY);
  console.log("\nFertig.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

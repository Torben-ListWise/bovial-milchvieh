#!/usr/bin/env tsx
/**
 * migrateKnowledge.ts
 *
 * One-shot script: copies all knowledge_documents and knowledge_chunks rows
 * (including their vector(768) embeddings) from the dev database to the
 * production database, and streams each document's physical file from dev
 * Replit object storage to the prod object storage backend.
 *
 * STORAGE
 * =======
 * Source is always the dev Replit GCS adapter (sidecar at 127.0.0.1:1106).
 * Destination is selected by STORAGE_PROVIDER (default "replit"):
 *   STORAGE_PROVIDER=replit   → ReplitObjectStorageAdapter (may share bucket with dev)
 *   STORAGE_PROVIDER=hetzner  → HetznerS3Adapter (requires HETZNER_S3_* env vars)
 *
 * File copy is idempotent: if the file already exists in prod storage it is
 * skipped (counted as "already present").
 *
 * DATABASE
 * ========
 * Accepts PROD_DATABASE_URL (full URL) OR individual PROD_PG* vars:
 *   PROD_PGHOST / PROD_PGPORT / PROD_PGUSER / PROD_PGPASSWORD / PROD_PGDATABASE
 *
 * USAGE
 * =====
 *   pnpm --filter api-server migrate:knowledge
 *
 * All inserts use ON CONFLICT (id) DO NOTHING — safe to re-run.
 */

import pg from "pg";
import { db, knowledgeDocumentsTable, knowledgeChunksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
// Import adapters directly — avoids objectStorage.ts's require() calls
// which are not compatible with ESM/tsx execution.
import { ReplitObjectStorageAdapter } from "../lib/replitStorageAdapter.js";
import type { IObjectStorageAdapter } from "../lib/storageInterface.js";
import { ObjectNotFoundError } from "../lib/objectStorage.js";

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

function redactUrl(url: string): string {
  try {
    return url.replace(/:[^@]+@/, ":***@");
  } catch {
    return "<redacted>";
  }
}

function resolveProdConnectionString(): string {
  if (process.env.PROD_DATABASE_URL) {
    return process.env.PROD_DATABASE_URL;
  }
  const host = process.env.PROD_PGHOST;
  const port = process.env.PROD_PGPORT ?? "5432";
  const user = process.env.PROD_PGUSER;
  const pass = process.env.PROD_PGPASSWORD;
  const db   = process.env.PROD_PGDATABASE;
  if (host && user && pass && db) {
    return `postgres://${user}:${encodeURIComponent(pass)}@${host}:${port}/${db}`;
  }
  console.error(`
ERROR: Production database not configured. Set ONE of:

  Option A — single URL:
    PROD_DATABASE_URL=postgres://user:password@host:5432/dbname

  Option B — individual vars:
    PROD_PGHOST=...
    PROD_PGPORT=5432
    PROD_PGUSER=...
    PROD_PGPASSWORD=...
    PROD_PGDATABASE=...
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Storage adapter factory (ESM-safe — no require())
// ---------------------------------------------------------------------------

async function createProdStorageAdapter(): Promise<IObjectStorageAdapter> {
  const provider = (process.env.STORAGE_PROVIDER ?? "replit").toLowerCase();
  if (provider === "hetzner") {
    const { HetznerS3Adapter } = await import("../lib/hetznerS3Adapter.js");
    return new HetznerS3Adapter();
  }
  // Default: Replit GCS (may share the same bucket as dev when PRIVATE_OBJECT_DIR
  // is a global secret; copy is still attempted and idempotency handles the duplicate)
  return new ReplitObjectStorageAdapter();
}

// ---------------------------------------------------------------------------
// File copy helper
// ---------------------------------------------------------------------------

async function copyFile(
  src: IObjectStorageAdapter,
  dest: IObjectStorageAdapter,
  objectPath: string,
): Promise<"copied" | "already_present" | "src_missing" | "error"> {
  if (!objectPath.startsWith("/objects/")) return "src_missing";

  // Check if already in prod (idempotency)
  try {
    await dest.getObjectEntityFile(objectPath);
    return "already_present";
  } catch (err: any) {
    if (!(err instanceof ObjectNotFoundError) && err?.name !== "ObjectNotFoundError") {
      console.warn(`  ⚠ Prod existence check failed for ${objectPath}: ${err}`);
      return "error";
    }
    // Not found in prod — proceed with copy
  }

  // Download from dev
  let buf: Buffer;
  let contentType: string;
  try {
    const srcFile = await src.getObjectEntityFile(objectPath);
    [buf] = await srcFile.download();
    const [meta] = await srcFile.getMetadata();
    contentType = meta.contentType ?? "application/octet-stream";
  } catch (err: any) {
    if (err instanceof ObjectNotFoundError || err?.name === "ObjectNotFoundError") {
      console.warn(`  ⚠ File not found in dev storage: ${objectPath}`);
      return "src_missing";
    }
    console.warn(`  ⚠ Dev download failed for ${objectPath}: ${err}`);
    return "error";
  }

  // Upload to prod
  const subpath = objectPath.slice("/objects/".length);
  try {
    await dest.uploadBytesAsEntity(subpath, buf, contentType);
    return "copied";
  } catch (err) {
    console.warn(`  ⚠ Prod upload failed for ${objectPath}: ${err}`);
    return "error";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHUNK_BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const PROD_DATABASE_URL = resolveProdConnectionString();

  if (!process.env.PRIVATE_OBJECT_DIR) {
    console.error("\nERROR: PRIVATE_OBJECT_DIR is required to read from dev Replit storage.\n");
    process.exit(1);
  }

  const provider = process.env.STORAGE_PROVIDER ?? "replit";

  console.log("\n=== Milchvieh Wissensbibliothek → Produktion ===");
  console.log(`Dev  DB  : ${redactUrl(process.env.DATABASE_URL ?? "")}`);
  console.log(`Prod DB  : ${redactUrl(PROD_DATABASE_URL)}`);
  console.log(`Storage  : ${provider} (STORAGE_PROVIDER)`);
  console.log(`Dev dir  : ${process.env.PRIVATE_OBJECT_DIR}`);
  console.log("");

  // Prod storage adapter (ESM-safe dynamic import)
  const prodStorage = await createProdStorageAdapter();

  // Source storage: always Replit GCS (dev sidecar)
  const devStorage = new ReplitObjectStorageAdapter();

  // Open prod DB connection
  const prodPool = new Pool({ connectionString: PROD_DATABASE_URL });
  try {
    await prodPool.query("SELECT 1");
    console.log("✓ Prod DB connection OK");
  } catch (err) {
    console.error(`\nERROR: Cannot connect to prod DB: ${err}\n`);
    await prodPool.end();
    process.exit(1);
  }

  // -------------------------------------------------------------------
  // 1. Load all knowledge documents from dev DB
  // -------------------------------------------------------------------
  console.log("\nLoading knowledge_documents from dev DB …");
  const docs = await db.select().from(knowledgeDocumentsTable);
  console.log(`  Found ${docs.length} document(s)`);

  if (docs.length === 0) {
    console.log("\nNothing to migrate.");
    await prodPool.end();
    return;
  }

  let docsInserted = 0;
  let docsAlreadyPresent = 0;
  let chunksCopied = 0;
  let filesCopied = 0;
  let filesAlreadyPresent = 0;
  let filesMissing = 0;
  const errors: string[] = [];

  // -------------------------------------------------------------------
  // 2. For each document: copy row, copy chunks, copy file
  // -------------------------------------------------------------------
  for (let docIdx = 0; docIdx < docs.length; docIdx++) {
    const doc = docs[docIdx];

    if (docIdx === 0 || (docIdx + 1) % 10 === 0) {
      console.log(`\n[${docIdx + 1}/${docs.length}] Processing: ${doc.title.slice(0, 60)}`);
    }

    // --- 2a. Insert document row into prod ---
    try {
      const result = await prodPool.query(
        `INSERT INTO knowledge_documents (
           id, title, filename, file_type, object_path, status,
           error_message, chunk_count, size, source_url, embedding_model,
           category, document_type, uploaded_by, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO NOTHING`,
        [
          doc.id,
          doc.title,
          doc.filename,
          doc.fileType,
          doc.objectPath,
          doc.status,
          doc.errorMessage ?? null,
          doc.chunkCount ?? null,
          doc.size ?? null,
          doc.sourceUrl ?? null,
          doc.embeddingModel ?? null,
          doc.category ?? null,
          doc.documentType ?? null,
          doc.uploadedBy,
          doc.createdAt,
        ]
      );
      if ((result.rowCount ?? 0) > 0) {
        docsInserted++;
      } else {
        docsAlreadyPresent++;
      }
    } catch (err) {
      const msg = `Doc ${doc.id} (${doc.title.slice(0, 40)}): insert failed — ${err}`;
      console.error(`  ✗ ${msg}`);
      errors.push(msg);
      continue;
    }

    // --- 2b. Copy chunks in batches of 500 ---
    const chunks = await db
      .select()
      .from(knowledgeChunksTable)
      .where(eq(knowledgeChunksTable.docId, doc.id));

    if (chunks.length > 0) {
      let batchStart = 0;
      while (batchStart < chunks.length) {
        const batch = chunks.slice(batchStart, batchStart + CHUNK_BATCH_SIZE);
        batchStart += CHUNK_BATCH_SIZE;

        // Build a multi-row INSERT with explicit ::vector cast for embedding
        const valuePlaceholders: string[] = [];
        const params: unknown[] = [];
        let pIdx = 1;

        for (const chunk of batch) {
          const embeddingStr = chunk.embedding
            ? `[${(chunk.embedding as number[]).join(",")}]`
            : null;

          valuePlaceholders.push(
            `($${pIdx++},$${pIdx++},$${pIdx++},$${pIdx++},` +
            (embeddingStr !== null ? `$${pIdx++}::vector` : `NULL`) +
            `)`
          );
          params.push(chunk.id, chunk.docId, chunk.chunkIndex, chunk.chunkText);
          if (embeddingStr !== null) params.push(embeddingStr);
        }

        try {
          const result = await prodPool.query(
            `INSERT INTO knowledge_chunks (id, doc_id, chunk_index, chunk_text, embedding)
             VALUES ${valuePlaceholders.join(",")}
             ON CONFLICT (id) DO NOTHING`,
            params
          );
          chunksCopied += result.rowCount ?? batch.length;
        } catch (err) {
          const msg = `Chunks for doc ${doc.id} batch@${batchStart}: insert failed — ${err}`;
          console.error(`  ✗ ${msg}`);
          errors.push(msg);
        }
      }
    }

    // --- 2c. Copy physical file from dev storage to prod storage ---
    if (doc.objectPath) {
      const result = await copyFile(devStorage, prodStorage, doc.objectPath);
      if (result === "copied") filesCopied++;
      else if (result === "already_present") filesAlreadyPresent++;
      else if (result === "src_missing") filesMissing++;
      else {
        errors.push(`File copy failed for doc ${doc.id} (${doc.objectPath})`);
      }
    }
  }

  // -------------------------------------------------------------------
  // 3. Verify row counts in prod DB
  // -------------------------------------------------------------------
  console.log("\n--- Verifying prod row counts …");
  const prodDocCount = await prodPool.query("SELECT COUNT(*) FROM knowledge_documents");
  const prodChunkCount = await prodPool.query("SELECT COUNT(*) FROM knowledge_chunks");
  const prodDocs = parseInt(prodDocCount.rows[0].count, 10);
  const prodChunks = parseInt(prodChunkCount.rows[0].count, 10);

  // -------------------------------------------------------------------
  // 4. Final summary
  // -------------------------------------------------------------------
  console.log("\n=== Summary ===");
  console.log(`  Documents inserted        : ${docsInserted}`);
  console.log(`  Documents already present : ${docsAlreadyPresent}`);
  console.log(`  Chunks inserted           : ${chunksCopied}`);
  console.log(`  Files copied              : ${filesCopied}`);
  console.log(`  Files already in prod     : ${filesAlreadyPresent}`);
  console.log(`  Files missing in dev      : ${filesMissing}`);
  console.log(`  Errors                    : ${errors.length}`);
  console.log("");
  console.log("  Prod DB counts after migration:");
  console.log(`    knowledge_documents : ${prodDocs}`);
  console.log(`    knowledge_chunks    : ${prodChunks}`);

  if (errors.length > 0) {
    console.log("\nErrors encountered:");
    for (const e of errors) console.error(`  - ${e}`);
  }

  await prodPool.end();

  if (errors.length > 0) {
    console.error("\nMigration completed with errors. Re-run to retry failed items.");
    process.exit(1);
  } else {
    console.log("\n✓ Migration completed successfully.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

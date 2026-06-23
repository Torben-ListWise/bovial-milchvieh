#!/usr/bin/env tsx
/**
 * migrate-storage.ts
 *
 * One-time migration script: copies all user files from Replit Object Storage
 * (GCS-backed) to Hetzner S3-compatible Object Storage.
 *
 * HOW IT WORKS
 * ============
 * In this app, all persisted file paths use the internal `/objects/<key>` format
 * (set by normalizeObjectEntityPath). The migration reads each object from Replit
 * GCS using the Replit adapter and writes it to Hetzner S3 under the same key.
 * Database rows do NOT change — the path stays `/objects/<key>` on both backends.
 * After migration, flipping STORAGE_PROVIDER=hetzner makes the app read/write
 * from Hetzner instead.
 *
 * PREREQUISITES
 * =============
 * - Run inside Replit (Replit sidecar must be available for GCS auth)
 * - PRIVATE_OBJECT_DIR set to the Replit bucket/dir (existing env var)
 * - HETZNER_S3_ENDPOINT, HETZNER_S3_BUCKET, HETZNER_S3_ACCESS_KEY, HETZNER_S3_SECRET_KEY
 * - DATABASE_URL pointing at the database to scan for file paths
 *
 * USAGE
 * =====
 *   # Dry run — prints files to migrate, no writes
 *   pnpm tsx src/scripts/migrate-storage.ts --dry-run
 *
 *   # Live run
 *   pnpm tsx src/scripts/migrate-storage.ts
 *
 *   # Resume after partial failure (already-migrated files are skipped)
 *   pnpm tsx src/scripts/migrate-storage.ts
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { isNotNull, eq } from "drizzle-orm";
import { db, sourceFilesTable } from "@workspace/db";
import { ReplitObjectStorageAdapter } from "../lib/replitStorageAdapter";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Environment variable ${key} is required`);
  return val;
}

const HETZNER_ENDPOINT = requireEnv("HETZNER_S3_ENDPOINT");
const HETZNER_BUCKET = requireEnv("HETZNER_S3_BUCKET");
const HETZNER_ACCESS_KEY = requireEnv("HETZNER_S3_ACCESS_KEY");
const HETZNER_SECRET_KEY = requireEnv("HETZNER_S3_SECRET_KEY");
const HETZNER_REGION = process.env.HETZNER_S3_REGION || "eu-central-1";

const s3 = new S3Client({
  endpoint: HETZNER_ENDPOINT,
  region: HETZNER_REGION,
  credentials: { accessKeyId: HETZNER_ACCESS_KEY, secretAccessKey: HETZNER_SECRET_KEY },
  forcePathStyle: true,
});

// The Replit adapter is the source — it reads from GCS via Replit sidecar.
// STORAGE_PROVIDER is intentionally ignored here so we always read from Replit.
const replitSource = new ReplitObjectStorageAdapter();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All `/objects/<key>` paths need migration; null/empty paths are skipped. */
function needsMigration(path: string | null | undefined): boolean {
  if (!path) return false;
  // All internal /objects/ paths currently live on Replit; they all need copying.
  // Only skip if the string is empty or somehow malformed.
  return path.startsWith("/objects/");
}

/** Extract the storage key from an internal `/objects/<key>` path. */
function toS3Key(objectPath: string): string {
  if (!objectPath.startsWith("/objects/")) {
    throw new Error(`Unexpected path format: ${objectPath}`);
  }
  return objectPath.slice("/objects/".length);
}

/** Check whether the key already exists in the Hetzner bucket. */
async function existsInHetzner(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: HETZNER_BUCKET, Key: key }));
    return true;
  } catch (err: any) {
    if (err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err; // unexpected error
  }
}

// ---------------------------------------------------------------------------
// Migration logic
// ---------------------------------------------------------------------------

interface MigrationItem {
  table: "source_files" | "knowledge_documents";
  id: string;
  objectPath: string;
}

async function collectItems(): Promise<MigrationItem[]> {
  const items: MigrationItem[] = [];

  // source_files.object_path
  const sourceFiles = await db
    .select({ id: sourceFilesTable.id, objectPath: sourceFilesTable.objectPath })
    .from(sourceFilesTable)
    .where(isNotNull(sourceFilesTable.objectPath));

  for (const row of sourceFiles) {
    if (needsMigration(row.objectPath)) {
      items.push({ table: "source_files", id: row.id, objectPath: row.objectPath! });
    }
  }

  // knowledge_documents.object_path — loaded dynamically because the export
  // may not be present in older db package versions.
  try {
    const dbModule = await import("@workspace/db") as any;
    const kdt = dbModule.knowledgeDocumentsTable;
    if (kdt) {
      const knowledgeDocs = await db
        .select({ id: kdt.id, objectPath: kdt.objectPath })
        .from(kdt)
        .where(isNotNull(kdt.objectPath));

      for (const row of knowledgeDocs) {
        if (needsMigration(row.objectPath)) {
          items.push({ table: "knowledge_documents", id: row.id, objectPath: row.objectPath! });
        }
      }
    }
  } catch {
    console.warn("  ⚠ knowledge_documents table not available — skipping");
  }

  return items;
}

async function migrateItem(item: MigrationItem): Promise<"ok" | "skip" | "error"> {
  const key = toS3Key(item.objectPath);

  console.log(`  [${item.table}] ${item.id}`);
  console.log(`    path   : ${item.objectPath}`);
  console.log(`    s3 key : ${key}`);

  if (DRY_RUN) {
    console.log(`    → dry-run, skipping`);
    return "skip";
  }

  // Skip if already uploaded to Hetzner (safe to re-run after partial failure)
  if (await existsInHetzner(key)) {
    console.log(`    → already exists in Hetzner, skipping`);
    return "ok";
  }

  // Download from Replit GCS using the Replit adapter (sidecar must be available)
  let buf: Buffer;
  let contentType: string;
  try {
    const file = await replitSource.getObjectEntityFile(item.objectPath);
    [buf] = await file.download();
    const [meta] = await file.getMetadata();
    contentType = meta.contentType || "application/octet-stream";
  } catch (err) {
    console.warn(`    ✗ Download from Replit failed: ${err}`);
    return "error";
  }

  // Upload to Hetzner S3
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: HETZNER_BUCKET,
        Key: key,
        Body: buf,
        ContentType: contentType,
      })
    );
    console.log(`    → uploaded ${buf.length} bytes (${contentType})`);
  } catch (err) {
    console.warn(`    ✗ Upload to Hetzner failed: ${err}`);
    return "error";
  }

  // Note: no DB update needed — paths stay as `/objects/<key>` on both backends.
  // After migration, set STORAGE_PROVIDER=hetzner to make the app use Hetzner.
  return "ok";
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== Milchvieh Storage Migration: Replit → Hetzner ===`);
  console.log(`Mode      : ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Target    : ${HETZNER_ENDPOINT} / ${HETZNER_BUCKET}`);
  console.log(`Database  : ${(process.env.DATABASE_URL ?? "").replace(/:[^@]+@/, ":***@")}`);
  console.log(`Source    : Replit GCS (PRIVATE_OBJECT_DIR=${process.env.PRIVATE_OBJECT_DIR ?? "not set"})\n`);

  if (!process.env.PRIVATE_OBJECT_DIR) {
    console.error("PRIVATE_OBJECT_DIR is required to read from Replit storage.");
    process.exit(1);
  }

  const items = await collectItems();

  if (items.length === 0) {
    console.log("✓ No files found in the database — nothing to migrate.");
    process.exit(0);
  }

  console.log(`Found ${items.length} file(s) to migrate.\n`);

  let ok = 0;
  let skip = 0;
  let errors = 0;

  for (const item of items) {
    const result = await migrateItem(item);
    if (result === "ok") ok++;
    else if (result === "skip") skip++;
    else errors++;
    console.log();
  }

  console.log("=== Summary ===");
  console.log(`  Migrated / already in Hetzner : ${ok}`);
  console.log(`  Skipped (dry-run)              : ${skip}`);
  console.log(`  Errors                         : ${errors}`);
  console.log();

  if (!DRY_RUN) {
    console.log("Next step: set STORAGE_PROVIDER=hetzner to activate Hetzner as the storage backend.");
  }

  if (errors > 0) {
    console.error(`${errors} file(s) failed. Re-run the script to retry — already-migrated files are skipped.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

import { pool } from "./index";

export async function ensureExtensions(): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  // Migration: add template_ref column for auto-analysis deduplication
  await pool.query(
    "ALTER TABLE analyses ADD COLUMN IF NOT EXISTS template_ref TEXT"
  );
  // Unique index to prevent race-condition duplicate auto-analyses
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS analyses_dataset_template_ref_unique ON analyses (dataset_id, template_ref) WHERE template_ref IS NOT NULL"
  );
}

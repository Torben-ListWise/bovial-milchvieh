import { pool } from "./index";

export async function ensureExtensions(): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
}

import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  date,
  index,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { analystRole } from "./analystRole";

export const sourceFilesTable = pgTable("source_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  datasetId: uuid("dataset_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type"),
  size: integer("size"),
  kind: text("kind"),
  status: text("status").notNull().default("uploaded"),
  rowCount: integer("row_count"),
  errorMessage: text("error_message"),
  columns: jsonb("columns"),
  mapping: jsonb("mapping"),
  previewRows: jsonb("preview_rows"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const dataRowsTable = pgTable(
  "data_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id").notNull(),
    fileId: uuid("file_id").notNull(),
    recordDate: date("record_date"),
    data: jsonb("data").notNull(),
  },
  (table) => [
    index("data_rows_dataset_idx").on(table.datasetId),
    index("data_rows_file_idx").on(table.fileId),
    // RLS policy: dataset-level row isolation for the analyst sandbox.
    // Defined here so Drizzle generates a correct CREATE POLICY (with full
    // USING clause) in the production migration before this file is deployed.
    // Also maintained as a DO-block fallback in setupAnalystSandbox()
    // (lib/db/src/migrate.ts) which additionally handles GRANT statements
    // that Drizzle cannot manage. If the `using` expression changes, update
    // BOTH this file and setupAnalystSandbox() in migrate.ts.
    pgPolicy("analyst_data_rows_isolation", {
      as: "permissive",
      for: "select",
      to: analystRole,
      using: sql`dataset_id::text = current_setting('app.current_dataset_id', true)`,
    }),
  ]
).enableRLS();

export type SourceFile = typeof sourceFilesTable.$inferSelect;
export type InsertSourceFile = typeof sourceFilesTable.$inferInsert;
export type DataRow = typeof dataRowsTable.$inferSelect;
export type InsertDataRow = typeof dataRowsTable.$inferInsert;

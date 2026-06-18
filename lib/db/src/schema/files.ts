import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  date,
  index,
} from "drizzle-orm/pg-core";

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
  ],
);

export type SourceFile = typeof sourceFilesTable.$inferSelect;
export type InsertSourceFile = typeof sourceFilesTable.$inferInsert;
export type DataRow = typeof dataRowsTable.$inferSelect;
export type InsertDataRow = typeof dataRowsTable.$inferInsert;

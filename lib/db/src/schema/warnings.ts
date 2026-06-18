import {
  pgTable,
  text,
  timestamp,
  uuid,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core";

export const warningsTable = pgTable(
  "warnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    metric: text("metric"),
    value: doublePrecision("value"),
    severity: text("severity").notNull().default("warning"),
    status: text("status").notNull().default("open"),
    ruleId: uuid("rule_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("warnings_dataset_idx").on(table.datasetId)],
);

export type Warning = typeof warningsTable.$inferSelect;
export type InsertWarning = typeof warningsTable.$inferInsert;

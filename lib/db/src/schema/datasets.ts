import {
  pgTable,
  text,
  timestamp,
  uuid,
  date,
  real,
  jsonb,
} from "drizzle-orm/pg-core";

export const datasetsTable = pgTable("datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("empty"),
  sector: text("sector").notNull().default("dairy"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  detectedFocusArea: text("detected_focus_area"),
  detectedFocusAreaConfidence: real("detected_focus_area_confidence"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  insightsSummary: jsonb("insights_summary").$type<{
    text: string;
    reportCount: number;
    basedOnReportIds: string[];
    generatedAt: string;
  }>(),
  insightsSummaryUpdatedAt: timestamp("insights_summary_updated_at", {
    withTimezone: true,
  }),
});

export type Dataset = typeof datasetsTable.$inferSelect;
export type InsertDataset = typeof datasetsTable.$inferInsert;

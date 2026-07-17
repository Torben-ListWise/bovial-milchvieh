import { pgTable, text, integer, uuid, timestamp, jsonb } from "drizzle-orm/pg-core";

export const creditUsageLogTable = pgTable("credit_usage_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  analysisId: uuid("analysis_id").notNull(),
  userId: text("user_id").notNull(),
  datasetId: uuid("dataset_id"),
  complexity: text("complexity").notNull(),
  credits: integer("credits").notNull(),
  toolsCalled: jsonb("tools_called").$type<string[]>().notNull().default([]),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  apiCostMillicents: integer("api_cost_millicents").default(0),
  plan: text("plan"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CreditUsageLog = typeof creditUsageLogTable.$inferSelect;
export type InsertCreditUsageLog = typeof creditUsageLogTable.$inferInsert;

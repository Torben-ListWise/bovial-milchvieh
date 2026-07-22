import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const betaToolLogsTable = pgTable(
  "beta_tool_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id"),
    analysisId: uuid("analysis_id").notNull(),
    userId: text("user_id").notNull(),
    toolName: text("tool_name").notNull(),
    keyParams: jsonb("key_params"),
    toolOutput: jsonb("tool_output"),
    durationMs: integer("duration_ms"),
    escalationTrigger: text("escalation_trigger"),
    escalationReason: text("escalation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("beta_tool_logs_analysis_idx").on(t.analysisId),
    index("beta_tool_logs_message_idx").on(t.messageId),
  ],
);

export type BetaToolLog = typeof betaToolLogsTable.$inferSelect;
export type InsertBetaToolLog = typeof betaToolLogsTable.$inferInsert;

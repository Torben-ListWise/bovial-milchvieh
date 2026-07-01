import {
  pgTable,
  integer,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

export const apiUsageLogTable = pgTable(
  "api_usage_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    modelUsed: text("model_used").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("api_usage_log_created_idx").on(table.createdAt)],
);

export type ApiUsageLog = typeof apiUsageLogTable.$inferSelect;
export type InsertApiUsageLog = typeof apiUsageLogTable.$inferInsert;

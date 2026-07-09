import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  customType,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config?: { dimensions?: number }) {
    return config?.dimensions ? `vector(${config.dimensions})` : "vector";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map(Number);
  },
});

// Persistent farm-context facts extracted from chat conversations.
// Deliberately NOT granted to the milchvieh_analyst SQL sandbox role — all reads
// go through the regular backend route with an explicit dataset_id filter and
// owner/guest permission check (see teamAccess.canReadDataset).
export const contextFactsTable = pgTable(
  "context_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id").notNull(),
    userId: text("user_id").notNull(), // dataset owner userId, for fast per-owner lookups
    category: text("category").notNull().default("sonstiges"), // verfahren | ausruestung | wartezeiten | sonstiges
    factText: text("fact_text").notNull(), // final text (post-correction if edited)
    originalText: text("original_text").notNull(), // original extracted proposal text
    status: text("status").notNull().default("vorgeschlagen"), // vorgeschlagen | aktiv | abgelehnt | deaktiviert
    sourceAnalysisId: uuid("source_analysis_id"),
    sourceMessageId: uuid("source_message_id"),
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    embedding: vector("embedding", { dimensions: 768 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("context_facts_dataset_idx").on(table.datasetId, table.status),
  ],
);

export type ContextFact = typeof contextFactsTable.$inferSelect;
export type InsertContextFact = typeof contextFactsTable.$inferInsert;

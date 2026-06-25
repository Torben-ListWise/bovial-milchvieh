import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const analysesTable = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    category: text("category"),
    pinned: boolean("pinned").notNull().default(false),
    tags: jsonb("tags").notNull().default([]),
    source: text("source").default("user"),
    templateRef: text("template_ref"),
    agentProgress: text("agent_progress"),
    agentSteps: jsonb("agent_steps").default([]),
    contextFileIds: jsonb("context_file_ids").default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("analyses_dataset_idx").on(table.datasetId)],
);

export const messagesTable = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id").notNull(),
    role: text("role").notNull(),
    content: text("content"),
    charts: jsonb("charts"),
    citations: jsonb("citations"),
    error: text("error"),
    followUpQuestions: jsonb("follow_up_questions"),
    backQuestions: jsonb("back_questions"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("messages_analysis_idx").on(table.analysisId)],
);

export type Analysis = typeof analysesTable.$inferSelect;
export type InsertAnalysis = typeof analysesTable.$inferInsert;
export type Message = typeof messagesTable.$inferSelect;
export type InsertMessage = typeof messagesTable.$inferInsert;

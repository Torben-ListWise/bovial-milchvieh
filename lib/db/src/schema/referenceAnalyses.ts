import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
} from "drizzle-orm/pg-core";

export const referenceAnalysesTable = pgTable("reference_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminUserId: text("admin_user_id").notNull(),
  status: text("status").notNull().default("pending_review"), // pending_review | confirmed | rejected
  rawInput: text("raw_input").notNull(),
  adminNote: text("admin_note"),
  uploadFilename: text("upload_filename"),
  imageObjectPath: text("image_object_path"),    // object-storage path for uploaded screenshot
  // AI-extracted fields (set on POST)
  extractedCommand: text("extracted_command"),
  extractedCommandSynonyms: jsonb("extracted_command_synonyms").$type<string[]>(),
  extractedPattern: text("extracted_pattern").notNull().default(""),
  extractedClassification: text("extracted_classification").notNull().default(""),
  extractedTopic: text("extracted_topic").notNull().default("Herdenmanagement"),
  // Command quality signals
  commandConfidence: text("command_confidence"),  // 'ok' | 'uncertain'
  commandAlternative: text("command_alternative"), // second-pass result if it differs
  commandFlags: jsonb("command_flags").$type<Array<{
    token: string;
    status: "ok" | "uncertain" | "unknown";
    suggestion?: string;
    distance?: number;
  }>>(),
  // Admin-edited versions (null = not edited, use extracted)
  editedPattern: text("edited_pattern"),
  editedClassification: text("edited_classification"),
  editedCommand: text("edited_command"),
  editedCommandSynonyms: jsonb("edited_command_synonyms").$type<string[]>(),
  // Set after confirmation
  knowledgeDocId: uuid("knowledge_doc_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReferenceAnalysis = typeof referenceAnalysesTable.$inferSelect;
export type InsertReferenceAnalysis = typeof referenceAnalysesTable.$inferInsert;

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
  rawInput: text("raw_input").notNull(),           // raw text from upload (or OCR) + admin note
  adminNote: text("admin_note"),                    // optional freetext annotation by admin
  uploadFilename: text("upload_filename"),          // original filename if an image was provided
  // AI-extracted fields (set on POST)
  extractedCommand: text("extracted_command"),      // DairyComp command found, or null
  extractedCommandSynonyms: jsonb("extracted_command_synonyms").$type<string[]>(),
  extractedPattern: text("extracted_pattern").notNull().default(""),
  extractedClassification: text("extracted_classification").notNull().default(""),
  extractedTopic: text("extracted_topic").notNull().default("Herdenmanagement"),
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

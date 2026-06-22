import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  integer,
} from "drizzle-orm/pg-core";

export const analysisTemplatesTable = pgTable("analysis_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  emoji: text("emoji").notNull().default("📊"),
  shortDescription: text("short_description").notNull().default(""),
  promptText: text("prompt_text").notNull(),
  categoryTag: text("category_tag"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AnalysisTemplate = typeof analysisTemplatesTable.$inferSelect;
export type InsertAnalysisTemplate = typeof analysisTemplatesTable.$inferInsert;

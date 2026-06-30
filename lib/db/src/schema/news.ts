import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const newsEditionsTable = pgTable(
  "news_editions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    teaser: text("teaser"),
    bodyMarkdown: text("body_markdown"),
    topicBadges: jsonb("topic_badges").$type<string[]>(),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("news_editions_status_idx").on(table.status)],
);

export type NewsEdition = typeof newsEditionsTable.$inferSelect;
export type InsertNewsEdition = typeof newsEditionsTable.$inferInsert;

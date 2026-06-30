import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
  integer,
  date,
  boolean,
} from "drizzle-orm/pg-core";

// ── Legacy table (kept for backward-compat) ───────────────────────────────────
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

// ── News topics (operator-managed rotation list) ──────────────────────────────
export const newsTopicsTable = pgTable("news_topics", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  color: text("color").notNull().default("blue"),
  sourceUrls: jsonb("source_urls").$type<string[]>().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NewsTopic = typeof newsTopicsTable.$inferSelect;
export type InsertNewsTopic = typeof newsTopicsTable.$inferInsert;

// ── Newsletter editions (AI-generated weekly batch) ───────────────────────────
export interface NewsSource {
  name: string;
  url: string;
}

export const newsletterEditionsTable = pgTable(
  "newsletter_editions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduledDate: date("scheduled_date").notNull(),
    topic: text("topic").notNull(),
    topicColor: text("topic_color").notNull().default("blue"),
    topicId: uuid("topic_id"),
    title: text("title").notNull(),
    appBody: text("app_body").notNull(),
    socialBody: text("social_body").notNull(),
    sources: jsonb("sources").$type<NewsSource[]>().default([]),
    ctaType: text("cta_type").notNull().default("chat_prompt"),
    ctaTarget: text("cta_target").notNull().default(""),
    status: text("status").notNull().default("draft"),
    batchRunAt: timestamp("batch_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("newsletter_editions_status_idx").on(table.status),
    index("newsletter_editions_scheduled_date_idx").on(table.scheduledDate),
  ],
);

export type NewsletterEdition = typeof newsletterEditionsTable.$inferSelect;
export type InsertNewsletterEdition =
  typeof newsletterEditionsTable.$inferInsert;

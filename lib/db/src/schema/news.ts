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

// ── Shared Newsletter Theme Config ────────────────────────────────────────────
// Single source of truth imported by both the API email renderer and the React
// in-app card. Keep this file free of any DB / Node-only imports.

export const NEWSLETTER_THEMES = {
  "Eutergesundheit":         { color: "#1565C0", bg: "#E3F2FD", emoji: "🦠" },
  "Fruchtbarkeit":           { color: "#6A1B9A", bg: "#F3E5F5", emoji: "🐄" },
  "Fütterung":               { color: "#2E7D32", bg: "#E8F5E9", emoji: "🌿" },
  "Klauengesundheit":        { color: "#E65100", bg: "#FFF3E0", emoji: "🦶" },
  "Hitzestress":             { color: "#C62828", bg: "#FFEBEE", emoji: "🌡️" },
  "Technik/Digitalisierung": { color: "#00695C", bg: "#E0F2F1", emoji: "📡" },
} as const;

export type NewsletterTopic = keyof typeof NEWSLETTER_THEMES;

export function getNewsletterTheme(topic: string): { color: string; bg: string; emoji: string } {
  return (NEWSLETTER_THEMES as Record<string, { color: string; bg: string; emoji: string }>)[topic]
    ?? { color: "#1565C0", bg: "#E3F2FD", emoji: "📰" };
}

// ── Newsletter editions (AI-generated weekly batch) ───────────────────────────
export interface NewsSource {
  name: string;
  url: string;
}

export interface KpiTile {
  value: string;
  label: string;
  sourceIndex: number;
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
    kpiTiles: jsonb("kpi_tiles").$type<KpiTile[]>().default([]),
    causeEffect: jsonb("cause_effect").$type<string[]>(),
    checklist: jsonb("checklist").$type<string[]>().default([]),
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

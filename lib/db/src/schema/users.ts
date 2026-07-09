import { pgTable, text, timestamp, boolean, doublePrecision, integer } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  role: text("role").notNull().default("customer"),
  focusAreas: text("focus_areas").array(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  digestOptOut: boolean("digest_opt_out").notNull().default(false),
  themePreference: text("theme_preference"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  stallCoolingCorrection: integer("stall_cooling_correction").notNull().default(0),
  contextFactsIntroSeenAt: timestamp("context_facts_intro_seen_at", { withTimezone: true }),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;

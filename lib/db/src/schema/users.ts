import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;

import { pgTable, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const subscriptionsTable = pgTable("subscriptions", {
  userId: text("user_id").primaryKey(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  gracePeriodEndsAt: timestamp("grace_period_ends_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Subscription = typeof subscriptionsTable.$inferSelect;
export type InsertSubscription = typeof subscriptionsTable.$inferInsert;

export const analysisQuotaTable = pgTable(
  "analysis_quota",
  {
    userId: text("user_id").notNull(),
    yearMonth: text("year_month").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("analysis_quota_user_month_idx").on(t.userId, t.yearMonth)],
);

export type AnalysisQuota = typeof analysisQuotaTable.$inferSelect;

export const stripeEventsTable = pgTable("stripe_events", {
  eventId: text("event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

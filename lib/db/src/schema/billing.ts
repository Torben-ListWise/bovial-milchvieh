import { pgTable, text, integer, timestamp, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";

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

export const teamInvitesTable = pgTable("team_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  hostUserId: text("host_user_id").notNull(),
  guestEmail: text("guest_email").notNull(),
  guestUserId: text("guest_user_id"),
  token: uuid("token").notNull().unique().defaultRandom(),
  status: text("status").notNull().default("pending"),
  /** 'team' = same-farm guest access; 'referral' = new independent farm referral */
  inviteType: text("invite_type").notNull().default("team"),
  /** True once referral bonuses have been granted to both sides. */
  referralBonusGranted: boolean("referral_bonus_granted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  transitionEndsAt: timestamp("transition_ends_at", { withTimezone: true }),
});

export type TeamInvite = typeof teamInvitesTable.$inferSelect;
export type InsertTeamInvite = typeof teamInvitesTable.$inferInsert;

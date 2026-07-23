import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Referral bonus credits granted when a user successfully invites a new,
 * independent farm via a "Landwirt wirbt Landwirt" referral link.
 * Both the referrer and the referee each receive a row.
 */
export const referralBonusesTable = pgTable(
  "referral_bonuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The user who receives the bonus (either referrer or referee). */
    userId: text("user_id").notNull(),
    /** The invite that triggered this bonus. */
    inviteId: uuid("invite_id").notNull(),
    /** Year-month this bonus applies to, format YYYY-MM. */
    yearMonth: text("year_month").notNull(),
    /** Number of bonus credits granted (positive integer). */
    bonusCredits: integer("bonus_credits").notNull().default(30),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("referral_bonuses_user_idx").on(t.userId),
    index("referral_bonuses_invite_idx").on(t.inviteId),
  ],
);

export type ReferralBonus = typeof referralBonusesTable.$inferSelect;
export type InsertReferralBonus = typeof referralBonusesTable.$inferInsert;

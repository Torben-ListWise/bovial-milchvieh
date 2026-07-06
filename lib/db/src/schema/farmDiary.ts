import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  date,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const farmDiaryEntriesTable = pgTable(
  "farm_diary_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    analysisId: uuid("analysis_id"),
    entryDate: date("entry_date").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    reminderDays: integer("reminder_days"),
    reminderDueAt: timestamp("reminder_due_at", { withTimezone: true }),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("farm_diary_userid_idx").on(table.userId),
    index("farm_diary_reminder_idx")
      .on(table.reminderDueAt)
      .where(sql`reminded_at IS NULL`),
  ],
);

export type FarmDiaryEntry = typeof farmDiaryEntriesTable.$inferSelect;
export type InsertFarmDiaryEntry = typeof farmDiaryEntriesTable.$inferInsert;

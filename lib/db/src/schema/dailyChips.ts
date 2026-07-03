import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Daily chip suggestions — the 3 chips shown on the Startseite.
 * Generated nightly by the chip scheduler from aggregated question_log data.
 * valid_date is the date on which these chips should be shown (= job run date + 1 day).
 */
export const dailyChipSuggestionsTable = pgTable(
  "daily_chip_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chipText: text("chip_text").notNull(),
    category: text("category").notNull(),
    rank: integer("rank").notNull(),
    validDate: date("valid_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("daily_chips_valid_date_idx").on(table.validDate),
  ],
);

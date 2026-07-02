import {
  pgTable,
  text,
  timestamp,
  uuid,
  doublePrecision,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";

export const thiForecasts = pgTable("thi_forecasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  outdoorThiCurrent: doublePrecision("outdoor_thi_current"),
  effectiveThiCurrent: doublePrecision("effective_thi_current"),
  status: text("status"),
  nextDayMaxThi: doublePrecision("next_day_max_thi"),
  heatStressHours: integer("heat_stress_hours"),
  hourlyData: jsonb("hourly_data"),
});

export type ThiForecast = typeof thiForecasts.$inferSelect;
export type InsertThiForecast = typeof thiForecasts.$inferInsert;

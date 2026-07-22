import {
  pgTable,
  text,
  integer,
  real,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

/**
 * Tages-Wetterdaten-Cache (DWD via Bright Sky API).
 *
 * Standort-Schlüssel:
 *   lat100 = ROUND(lat * 100) — z.B. 5250 für 52.50° N
 *   lon100 = ROUND(lon * 100) — z.B.  940 für  9.40° E
 *
 * Durch die 2-Dezimalstellen-Rundung (~1.1 km Gitter) teilen sich Betriebe
 * in derselben Gegend dieselben Wetterdaten → kein doppelter API-Abruf.
 *
 * THI-Formel: (1.8·T + 32) − (0.55 − 0.0055·RH) · (1.8·T − 26)
 */
export const weatherDailyCacheTable = pgTable(
  "weather_daily_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Breitengrad × 100 gerundet — z.B. 5250 für 52.50° N */
    lat100: integer("lat100").notNull(),

    /** Längengrad × 100 gerundet — z.B.  940 für  9.40° E */
    lon100: integer("lon100").notNull(),

    /** Datum als YYYY-MM-DD Text */
    date: text("date").notNull(),

    /** Tagesmitteltemperatur (°C) */
    tempMean: real("temp_mean"),

    /** Tageshöchsttemperatur (°C) */
    tempMax: real("temp_max"),

    /** Tagestiefsttemperatur (°C) */
    tempMin: real("temp_min"),

    /** Mittlere relative Luftfeuchte (%) */
    humidityMean: real("humidity_mean"),

    /** THI aus Tageshöchsttemperatur + mittlere Luftfeuchte */
    thiMax: real("thi_max"),

    /** THI aus Tagesmitteltemperatur + mittlere Luftfeuchte */
    thiMean: real("thi_mean"),

    /** Zeitpunkt des API-Abrufs */
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("weather_daily_cache_loc_date_idx").on(
      table.lat100,
      table.lon100,
      table.date,
    ),
  ],
);

export type WeatherDailyCache = typeof weatherDailyCacheTable.$inferSelect;
export type InsertWeatherDailyCache =
  typeof weatherDailyCacheTable.$inferInsert;

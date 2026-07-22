/**
 * DWD-Wetterdaten-Client (via Bright Sky API).
 *
 * Bright Sky (https://api.brightsky.dev) ist ein kostenloser Open-Source-
 * Wrapper um den DWD Open Data (CDC). Lizenz: CC BY 4.0, identisch mit dem
 * DWD-Open-Data-Angebot. Kein API-Key erforderlich.
 *
 * Öffentliche Funktionen:
 *   computeTHI(tempC, rhPct)        — Brügemann-Formel
 *   toCoordKey(lat, lon)            — { lat100, lon100 } Ganzzahl-Keys (~1.1 km Gitter)
 *   ensureWeatherCached(...)        — DB-Check + Bright-Sky-Fetch für fehlende Tage
 *   getWeatherForDates(...)         — Map<date, DailyWeather> aus Cache
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, pool, weatherDailyCacheTable } from "@workspace/db";
import { logger } from "./logger";

export interface DailyWeather {
  date: string;
  tempMean: number;
  tempMax: number;
  tempMin: number;
  humidityMean: number;
  thiMax: number;
  thiMean: number;
}

// ── THI-Formel (Brügemann et al. 2012) ───────────────────────────────────────

export function computeTHI(tempC: number, rhPct: number): number {
  return (1.8 * tempC + 32) - (0.55 - 0.0055 * rhPct) * (1.8 * tempC - 26);
}

// ── Koordinaten-Schlüssel ─────────────────────────────────────────────────────

export function toCoordKey(lat: number, lon: number): { lat100: number; lon100: number } {
  return {
    lat100: Math.round(lat * 100),
    lon100: Math.round(lon * 100),
  };
}

// ── Bright Sky Fetch ──────────────────────────────────────────────────────────

const BRIGHT_SKY_BASE = "https://api.brightsky.dev/weather";
const CHUNK_DAYS = 90;

interface BrightSkyHour {
  timestamp: string;
  temperature: number | null;
  relative_humidity: number | null;
}

export async function fetchDailyWeatherFromBrightSky(
  lat: number,
  lon: number,
  dateFrom: string,
  dateTo: string,
): Promise<DailyWeather[]> {
  const url =
    `${BRIGHT_SKY_BASE}?lat=${lat}&lon=${lon}&date=${dateFrom}&last_date=${dateTo}&units=dwd`;

  const resp = await fetch(url, {
    headers: { "User-Agent": "BovialWeatherBot/1.0" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new Error(`Bright Sky HTTP ${resp.status} für ${dateFrom}–${dateTo}`);
  }

  const body = (await resp.json()) as { weather: BrightSkyHour[] };
  const hours = body.weather ?? [];

  const dayMap = new Map<string, { temps: number[]; hums: number[] }>();
  for (const h of hours) {
    const date = h.timestamp.slice(0, 10);
    if (!dayMap.has(date)) dayMap.set(date, { temps: [], hums: [] });
    const d = dayMap.get(date)!;
    if (h.temperature != null) d.temps.push(h.temperature);
    if (h.relative_humidity != null) d.hums.push(h.relative_humidity);
  }

  const result: DailyWeather[] = [];
  for (const [date, { temps, hums }] of dayMap) {
    if (temps.length === 0) continue;
    const tempMean = temps.reduce((a, b) => a + b, 0) / temps.length;
    const tempMax = Math.max(...temps);
    const tempMin = Math.min(...temps);
    const humidityMean =
      hums.length > 0 ? hums.reduce((a, b) => a + b, 0) / hums.length : 70;
    result.push({
      date,
      tempMean: Math.round(tempMean * 10) / 10,
      tempMax: Math.round(tempMax * 10) / 10,
      tempMin: Math.round(tempMin * 10) / 10,
      humidityMean: Math.round(humidityMean * 10) / 10,
      thiMax: Math.round(computeTHI(tempMax, humidityMean) * 10) / 10,
      thiMean: Math.round(computeTHI(tempMean, humidityMean) * 10) / 10,
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Datum-Hilfsfunktionen ─────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function chunkDateRange(
  from: string,
  to: string,
  days: number,
): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  let cur = from;
  while (cur <= to) {
    const end = addDays(cur, days - 1);
    chunks.push({ from: cur, to: end > to ? to : end });
    cur = addDays(end, 1);
  }
  return chunks;
}

// ── Cache-Management ──────────────────────────────────────────────────────────

/** Fehlende Wetterdaten von Bright Sky fetchen und in DB speichern. */
export async function ensureWeatherCached(
  lat: number,
  lon: number,
  dates: string[],
): Promise<void> {
  if (dates.length === 0) return;

  const { lat100, lon100 } = toCoordKey(lat, lon);

  const cached = await db
    .select({ date: weatherDailyCacheTable.date })
    .from(weatherDailyCacheTable)
    .where(
      and(
        eq(weatherDailyCacheTable.lat100, lat100),
        eq(weatherDailyCacheTable.lon100, lon100),
        inArray(weatherDailyCacheTable.date, dates),
      ),
    );

  const cachedSet = new Set(cached.map((r) => r.date));
  const missing = dates.filter((d) => !cachedSet.has(d));
  if (missing.length === 0) return;

  const sorted = [...missing].sort();
  const rangeFrom = sorted[0];
  const rangeTo = sorted[sorted.length - 1];

  logger.info(
    { lat100, lon100, missing: missing.length, rangeFrom, rangeTo },
    "Wetterdaten werden von Bright Sky geholt",
  );

  for (const chunk of chunkDateRange(rangeFrom, rangeTo, CHUNK_DAYS)) {
    try {
      const daily = await fetchDailyWeatherFromBrightSky(lat, lon, chunk.from, chunk.to);
      const toInsert = daily.filter((d) => missing.includes(d.date));
      if (toInsert.length === 0) continue;

      // Pool-basiertes bulk-INSERT mit ON CONFLICT DO NOTHING
      const placeholders = toInsert
        .map(
          (_, i) =>
            `($1, $2, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7}, $${i * 7 + 8}, $${i * 7 + 9})`,
        )
        .join(", ");

      await pool.query(
        `INSERT INTO weather_daily_cache
           (lat100, lon100, date, temp_mean, temp_max, temp_min, humidity_mean, thi_max, thi_mean)
         VALUES ${placeholders}
         ON CONFLICT (lat100, lon100, date) DO NOTHING`,
        [
          lat100,
          lon100,
          ...toInsert.flatMap((d) => [
            d.date,
            d.tempMean,
            d.tempMax,
            d.tempMin,
            d.humidityMean,
            d.thiMax,
            d.thiMean,
          ]),
        ],
      );

      logger.info(
        { chunk: `${chunk.from}–${chunk.to}`, inserted: toInsert.length },
        "Wetterdaten gecacht",
      );
    } catch (err) {
      logger.warn({ err, chunk }, "Wetterdaten-Chunk fehlgeschlagen");
    }
  }
}

/** Gecachte Wetterdaten für die gegebenen Daten zurückgeben. */
export async function getWeatherForDates(
  lat: number,
  lon: number,
  dates: string[],
): Promise<Map<string, DailyWeather>> {
  if (dates.length === 0) return new Map();

  const { lat100, lon100 } = toCoordKey(lat, lon);

  const rows = await db
    .select()
    .from(weatherDailyCacheTable)
    .where(
      and(
        eq(weatherDailyCacheTable.lat100, lat100),
        eq(weatherDailyCacheTable.lon100, lon100),
        inArray(weatherDailyCacheTable.date, dates),
      ),
    );

  const map = new Map<string, DailyWeather>();
  for (const r of rows) {
    if (
      r.tempMean == null ||
      r.tempMax == null ||
      r.tempMin == null ||
      r.humidityMean == null ||
      r.thiMax == null ||
      r.thiMean == null
    )
      continue;
    map.set(r.date, {
      date: r.date,
      tempMean: r.tempMean,
      tempMax: r.tempMax,
      tempMin: r.tempMin,
      humidityMean: r.humidityMean,
      thiMax: r.thiMax,
      thiMean: r.thiMean,
    });
  }
  return map;
}

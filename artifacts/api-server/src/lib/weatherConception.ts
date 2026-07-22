/**
 * Korrelationsberechnung: DWD-Wetter × Besamungs-Konzeptionsrate.
 *
 * Logik:
 *   1. BRED-Events des Datensatzes abrufen.
 *   2. Wetterdate = Besamungsdatum + offsetDays.
 *   3. Wetterdaten sicherstellen (Cache prüfen, ggf. von Bright Sky fetchen).
 *   4. Monatliche Konzeptionsrate (PREG/BRED) mit Ø THI / Ø Temp verknüpfen.
 *   5. Pearson-Korrelationskoeffizient r(THI, Konzeptionsrate) berechnen.
 */

import { sql, eq, and } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { ensureWeatherCached, getWeatherForDates } from "./weatherClient";
import { logger } from "./logger";

export interface ConceptionWeatherPoint {
  month: string;         // YYYY-MM
  monthLabel: string;    // z.B. "Jun 23"
  bred_count: number;
  preg_count: number;
  conception_rate: number | null; // %
  avg_thi: number | null;
  avg_thi_mean: number | null;
  avg_temp: number | null;
}

export interface ConceptionWeatherResult {
  series: ConceptionWeatherPoint[];
  pearson_r: number | null;    // Korrelation r(THI_max, KR)
  pearson_r_temp: number | null; // Korrelation r(Temp_max, KR)
  offset_days: number;
  data_months: number;
  missing_weather_months: number;
  lat: number;
  lon: number;
  station_note: string;
}

// ── Pearson r ─────────────────────────────────────────────────────────────────

function pearsonR(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const cov = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0);
  const sx = Math.sqrt(xs.reduce((acc, x) => acc + (x - mx) ** 2, 0));
  const sy = Math.sqrt(ys.reduce((acc, y) => acc + (y - my) ** 2, 0));
  if (sx === 0 || sy === 0) return null;
  const r = cov / (sx * sy);
  return Math.round(r * 1000) / 1000;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const months = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
  return `${months[parseInt(m) - 1]} ${y.slice(2)}`;
}

// ── Hauptfunktion ─────────────────────────────────────────────────────────────

export async function computeWeatherConceptionCorrelation(
  datasetId: string,
  lat: number,
  lon: number,
  offsetDays: number,
): Promise<ConceptionWeatherResult> {
  offsetDays = Math.max(-365, Math.min(365, Math.round(offsetDays)));

  // 1. BRED-Events abrufen (Datum + ob konzipiert)
  const bredResult = await pool.query<{
    event_date: string;
    animal_id: string;
    conceived: boolean;
  }>(
    `
    WITH bred AS (
      SELECT animal_id, event_date::text AS event_date
      FROM   cow_events
      WHERE  dataset_id = $1
        AND  event_type = 'BRED'
    )
    SELECT
      b.animal_id,
      b.event_date,
      EXISTS(
        SELECT 1 FROM cow_events p
        WHERE  p.dataset_id = $1
          AND  p.event_type = 'PREG'
          AND  p.animal_id  = b.animal_id
          AND  p.event_date BETWEEN b.event_date::date
                                AND (b.event_date::date + INTERVAL '120 days')::date
      ) AS conceived
    FROM bred b
    ORDER BY b.event_date
    `,
    [datasetId],
  );

  const bredEvents = bredResult.rows;

  if (bredEvents.length === 0) {
    return {
      series: [],
      pearson_r: null,
      pearson_r_temp: null,
      offset_days: offsetDays,
      data_months: 0,
      missing_weather_months: 0,
      lat,
      lon,
      station_note: "Keine BRED-Events vorhanden",
    };
  }

  // 2. Wetterdaten für (Besamungsdatum + Versatz) sicherstellen
  const weatherDates = [
    ...new Set(
      bredEvents.map((e) => {
        const d = new Date(e.event_date);
        d.setDate(d.getDate() + offsetDays);
        return d.toISOString().slice(0, 10);
      }),
    ),
  ];

  logger.info(
    { datasetId, offsetDays, weatherDateCount: weatherDates.length },
    "Wetterdaten werden sichergestellt",
  );

  try {
    await ensureWeatherCached(lat, lon, weatherDates);
  } catch (err) {
    logger.warn({ err }, "Wetterdaten-Caching teilweise fehlgeschlagen");
  }

  const weatherMap = await getWeatherForDates(lat, lon, weatherDates);

  // 3. Monatliche Aggregation (nach Besamungsmonat)
  interface MonthAgg {
    bred: number;
    preg: number;
    this_vals: number[];
    thi_mean_vals: number[];
    temp_vals: number[];
  }

  const months = new Map<string, MonthAgg>();

  for (const event of bredEvents) {
    const ym = event.event_date.slice(0, 7);
    if (!months.has(ym)) {
      months.set(ym, { bred: 0, preg: 0, this_vals: [], thi_mean_vals: [], temp_vals: [] });
    }
    const m = months.get(ym)!;
    m.bred++;
    if (event.conceived) m.preg++;

    // Wetterdatum = Besamungsdatum + Versatz
    const d = new Date(event.event_date);
    d.setDate(d.getDate() + offsetDays);
    const weatherDate = d.toISOString().slice(0, 10);
    const w = weatherMap.get(weatherDate);
    if (w) {
      if (w.thiMax != null) m.this_vals.push(w.thiMax);
      if (w.thiMean != null) m.thi_mean_vals.push(w.thiMean);
      if (w.tempMax != null) m.temp_vals.push(w.tempMax);
    }
  }

  const MIN_BRED = 5;
  const series: ConceptionWeatherPoint[] = [];
  let missingWeatherMonths = 0;

  for (const [ym, agg] of [...months.entries()].sort()) {
    if (agg.bred < MIN_BRED) continue;

    const avg = (arr: number[]) =>
      arr.length > 0
        ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
        : null;

    const avg_thi = avg(agg.this_vals);
    if (avg_thi == null) missingWeatherMonths++;

    series.push({
      month: ym,
      monthLabel: formatMonthLabel(ym),
      bred_count: agg.bred,
      preg_count: agg.preg,
      conception_rate:
        agg.bred > 0
          ? Math.round((agg.preg / agg.bred) * 1000) / 10
          : null,
      avg_thi,
      avg_thi_mean: avg(agg.thi_mean_vals),
      avg_temp: avg(agg.temp_vals),
    });
  }

  // 4. Pearson r (nur Monate mit Wetter- UND Konzeptionsdaten)
  const complete = series.filter(
    (p) => p.conception_rate != null && p.avg_thi != null,
  );
  const thisValues = complete.map((p) => p.avg_thi!);
  const krValues = complete.map((p) => p.conception_rate!);
  const tempValues = complete.map((p) => p.avg_temp ?? p.avg_thi!);

  return {
    series,
    pearson_r: pearsonR(thisValues, krValues),
    pearson_r_temp: pearsonR(tempValues, krValues),
    offset_days: offsetDays,
    data_months: series.length,
    missing_weather_months: missingWeatherMonths,
    lat,
    lon,
    station_note: `DWD-Daten via Bright Sky API (CC BY 4.0) · Standort ${lat.toFixed(2)}° N, ${lon.toFixed(2)}° E`,
  };
}

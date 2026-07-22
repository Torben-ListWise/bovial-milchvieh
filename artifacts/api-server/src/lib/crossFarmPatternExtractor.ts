/**
 * Betriebsübergreifende Muster-Erkennung (Weekly Batch).
 *
 * Identifiziert statistische Auffälligkeiten bei opt-in-Betrieben:
 * Betriebe, die eine messbare KPI-Verbesserung zeigten, mit optionaler
 * Kontextzuordnung aus gespeicherten Betriebsfakten.
 *
 * Erkannte Kandidaten landen als status='pending' in cross_farm_patterns
 * und müssen vom Operator fachlich geprüft werden, bevor sie freigegeben werden.
 *
 * ⚠️  RECHTSHINWEIS: Diese Funktion verarbeitet nur Daten von Nutzern, die
 *     explizit in pattern_sharing_opted_in=TRUE eingewilligt haben.
 *     Der finale Einwilligungstext muss noch durch einen DSGVO-Anwalt geprüft werden.
 */

import { sql, and, eq, isNotNull } from "drizzle-orm";
import { createHash } from "crypto";
import {
  db,
  usersTable,
  crossFarmPatternsTable,
} from "@workspace/db";
import { logger } from "./logger";

interface MonthlyKpi {
  month: string;
  conceived: number;
  bred: number;
  rate: number;
}

interface FarmCandidate {
  userId: string;
  datasetId: string;
  kpiName: string;
  changeDescription: string | null;
  baselineMean: number;
  afterMean: number;
  improvement: number;
  observationPeriodMonths: number;
}

/** Einfache lineare Glättung: Durchschnitt über ein gleitendes Fenster */
function rollingMean(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Erkennt Schritt-Veränderungen: vorher/nachher-Vergleich mit Schwellenwert */
function detectStepChange(
  series: MonthlyKpi[],
  minImprovement: number,
  windowSize: number,
): { breakIndex: number; baselineMean: number; afterMean: number } | null {
  if (series.length < windowSize * 2) return null;

  const rates = series.map((s) => s.rate);
  const smoothed = rollingMean(rates, 3);

  for (let i = windowSize; i <= smoothed.length - windowSize; i++) {
    const before = smoothed.slice(i - windowSize, i);
    const after = smoothed.slice(i, i + windowSize);
    const beforeMean = before.reduce((a, b) => a + b, 0) / before.length;
    const afterMean = after.reduce((a, b) => a + b, 0) / after.length;
    if (afterMean - beforeMean >= minImprovement) {
      return { breakIndex: i, baselineMean: beforeMean, afterMean };
    }
  }
  return null;
}

/** Berechnet monatliche Konzeptionsraten für ein Dataset aus cow_events */
async function getMonthlyConceptionRate(
  datasetId: string,
): Promise<MonthlyKpi[]> {
  const rows = await db.execute(sql`
    WITH bred AS (
      SELECT
        animal_id,
        event_date,
        DATE_TRUNC('month', event_date)::date AS month
      FROM cow_events
      WHERE dataset_id = ${datasetId}
        AND event_type = 'BRED'
    ),
    preg AS (
      SELECT DISTINCT b.animal_id, b.event_date AS bred_date
      FROM bred b
      JOIN cow_events p ON p.dataset_id = ${datasetId}
        AND p.event_type = 'PREG'
        AND p.animal_id = b.animal_id
        AND p.event_date BETWEEN b.event_date AND b.event_date + INTERVAL '120 days'
    )
    SELECT
      TO_CHAR(b.month, 'YYYY-MM') AS month,
      COUNT(DISTINCT b.animal_id || '-' || b.event_date::text)::int AS bred,
      COUNT(DISTINCT p.animal_id || '-' || p.bred_date::text)::int AS conceived
    FROM bred b
    LEFT JOIN preg p ON p.animal_id = b.animal_id AND p.bred_date = b.event_date
    GROUP BY b.month
    ORDER BY b.month
  `);

  return (rows.rows as Array<{ month: string; bred: number; conceived: number }>)
    .filter((r) => r.bred >= 5)
    .map((r) => ({
      month: r.month,
      bred: r.bred,
      conceived: r.conceived,
      rate: (r.conceived / r.bred) * 100,
    }));
}

/** Sucht context_facts-Einträge nahe eines Zeitpunkts (±60 Tage) */
async function findNearbyContextChange(
  userId: string,
  monthStr: string,
): Promise<string | null> {
  try {
    const [year, mon] = monthStr.split("-").map(Number);
    const breakDate = new Date(year, mon - 1, 1);
    const fromDate = new Date(breakDate.getTime() - 60 * 86400_000);
    const toDate = new Date(breakDate.getTime() + 60 * 86400_000);

    const rows = await db.execute(sql`
      SELECT content
      FROM context_facts
      WHERE user_id = ${userId}
        AND confirmed = TRUE
        AND created_at BETWEEN ${fromDate.toISOString()} AND ${toDate.toISOString()}
      ORDER BY created_at
      LIMIT 3
    `);

    const facts = (rows.rows as Array<{ content: string }>).map((r) =>
      r.content.slice(0, 100),
    );
    return facts.length > 0 ? facts.join("; ") : null;
  } catch {
    return null;
  }
}

/** Stabile Hash-Funktion für Deduplizierung */
function makeExtractionHash(
  datasetId: string,
  kpiName: string,
  breakMonth: string,
  improvement: number,
): string {
  return createHash("sha256")
    .update(`${datasetId}:${kpiName}:${breakMonth}:${Math.round(improvement * 10)}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Hauptfunktion: Analysiert alle opt-in-Betriebe und erstellt Kandidaten-Muster.
 * Gibt Anzahl gefundener / neu angelegter Kandidaten zurück.
 */
export async function runPatternExtraction(): Promise<{
  analyzed: number;
  candidates: number;
  inserted: number;
  skipped: number;
}> {
  let analyzed = 0;
  let candidates = 0;
  let inserted = 0;
  let skipped = 0;

  const MIN_IMPROVEMENT_PP = 8;
  const WINDOW_SIZE = 3;

  try {
    const optInUsers = await db
      .select({
        id: usersTable.id,
      })
      .from(usersTable)
      .where(
        and(
          eq((usersTable as any).patternSharingOptedIn, true),
          isNotNull(usersTable.id),
        ),
      );

    logger.info({ count: optInUsers.length }, "Pattern extraction: opt-in Betriebe geladen");

    for (const user of optInUsers) {
      analyzed++;

      const datasets = await db.execute(sql`
        SELECT id FROM datasets WHERE user_id = ${user.id} LIMIT 5
      `);

      for (const row of datasets.rows as Array<{ id: string }>) {
        const series = await getMonthlyConceptionRate(row.id);
        if (series.length < WINDOW_SIZE * 2) continue;

        const step = detectStepChange(series, MIN_IMPROVEMENT_PP, WINDOW_SIZE);
        if (!step) continue;

        candidates++;
        const breakMonth = series[step.breakIndex]?.month ?? "unknown";
        const improvement = step.afterMean - step.baselineMean;

        const hash = makeExtractionHash(row.id, "konzeptionsrate", breakMonth, improvement);

        const existing = await db
          .select({ id: crossFarmPatternsTable.id })
          .from(crossFarmPatternsTable)
          .where(eq(crossFarmPatternsTable.extractionHash, hash))
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        const changeDesc = await findNearbyContextChange(user.id, breakMonth);

        await db.insert(crossFarmPatternsTable).values({
          kpiName: "konzeptionsrate",
          changeDescription: changeDesc,
          baselineValue: Math.round(step.baselineMean * 10) / 10,
          afterValue: Math.round(step.afterMean * 10) / 10,
          avgImprovement: Math.round(improvement * 10) / 10,
          sampleSize: 1,
          observationPeriodMonths: series.length,
          extractionHash: hash,
          relevanceTags: ["milchvieh", "konzeptionsrate"],
          status: "pending",
        });
        inserted++;
      }
    }

    logger.info({ analyzed, candidates, inserted, skipped }, "Pattern extraction abgeschlossen");
  } catch (err) {
    logger.error({ err }, "Pattern extraction fehlgeschlagen");
  }

  return { analyzed, candidates, inserted, skipped };
}

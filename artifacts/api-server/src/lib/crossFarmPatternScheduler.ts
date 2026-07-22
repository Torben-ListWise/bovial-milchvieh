/**
 * Wöchentlicher Scheduler für betriebsübergreifende Erfolgsmuster.
 *
 * Läuft wöchentlich sonntags um 03:00 Uhr (stündliche Prüfung).
 * Externe Auslösung: POST /api/admin/cron/run-pattern-extraction (X-Cron-Secret)
 *
 * Logik:
 *   1. Lädt alle Nutzer mit pattern_sharing_opted_in = TRUE.
 *   2. Berechnet monatliche KPI-Zeitreihen (Konzeptionsrate, etc.).
 *   3. Erkennt signifikante Schritt-Verbesserungen (≥8 Prozentpunkte, 3 Monate stabil).
 *   4. Legt neue Kandidaten als status='pending' an (dedupliciert via extraction_hash).
 *   5. Operator prüft und gibt frei.
 */

import { runPatternExtraction } from "./crossFarmPatternExtractor";
import { logger } from "./logger";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startCrossFarmPatternScheduler(): void {
  if (schedulerInterval) return;

  let lastRun: Date | null = null;

  schedulerInterval = setInterval(async () => {
    const now = new Date();
    const isSunday = now.getDay() === 0;
    const isTargetHour = now.getHours() === 3;

    if (!isSunday || !isTargetHour) return;
    if (lastRun && now.getTime() - lastRun.getTime() < 20 * 60 * 60 * 1000) return;

    lastRun = now;
    logger.info("CrossFarm pattern extraction gestartet (wöchentlicher Batch)");

    try {
      const result = await runPatternExtraction();
      logger.info(
        { analyzed: result.analyzed, candidates: result.candidates, inserted: result.inserted, skipped: result.skipped },
        "CrossFarm pattern extraction abgeschlossen",
      );
    } catch (err) {
      logger.error({ err }, "CrossFarm pattern extraction fehlgeschlagen");
    }
  }, 60 * 60 * 1000);

  logger.info("CrossFarm pattern scheduler gestartet (wöchentlich sonntags 03:00)");
}

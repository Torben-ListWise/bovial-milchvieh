/**
 * Täglicher Scheduler für amtliche Tierseuchen-/Gesundheitswarnungen.
 *
 * Läuft täglich um 07:00 Uhr (stündliche Prüfung).
 * Externe Auslösung: POST /api/admin/cron/run-health-alerts (X-Cron-Secret)
 *
 * Logik:
 *   1. Fetche alle konfigurierten Quellen (FLI, LAVES NDS, ...).
 *   2. Prüfe per externalId, ob ein Eintrag bereits existiert.
 *   3. Neue Einträge werden als status='pending' angelegt.
 *   4. Bestehende Einträge (gleiche externalId) werden nicht doppelt angelegt.
 */

import { eq, and } from "drizzle-orm";
import { db, animalHealthAlertsTable } from "@workspace/db";
import { fetchAllHealthAlerts } from "./healthAlertFetcher";
import { logger } from "./logger";

export async function runHealthAlertFetch(): Promise<{
  fetched: number;
  inserted: number;
  skipped: number;
}> {
  let fetched = 0;
  let inserted = 0;
  let skipped = 0;

  try {
    const alerts = await fetchAllHealthAlerts();
    fetched = alerts.length;

    for (const alert of alerts) {
      const existing = await db
        .select({ id: animalHealthAlertsTable.id })
        .from(animalHealthAlertsTable)
        .where(
          and(
            eq(animalHealthAlertsTable.sourceKey, alert.sourceKey),
            eq(animalHealthAlertsTable.externalId, alert.externalId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(animalHealthAlertsTable).values({
        sourceKey: alert.sourceKey,
        externalId: alert.externalId,
        topic: alert.topic,
        title: alert.title,
        summary: alert.summary,
        sourceUrl: alert.sourceUrl,
        officialDate: alert.officialDate ?? undefined,
        affectedSpecies: alert.affectedSpecies,
        status: "pending",
      });
      inserted++;
    }

    logger.info({ fetched, inserted, skipped }, "Health-Alert-Scheduler abgeschlossen");
  } catch (err) {
    logger.error({ err }, "Health-Alert-Scheduler Fehler");
  }

  return { fetched, inserted, skipped };
}

/**
 * In-Process-Scheduler: stündliche Prüfung, Ausführung täglich 07:00.
 */
export function startHealthAlertScheduler(): void {
  logger.info(
    "Health-Alert-Scheduler gestartet (stündliche Prüfung, Ausführung täglich 07:00 Uhr)",
  );
  setInterval(
    () => {
      const h = new Date().getHours();
      if (h !== 7) return;
      runHealthAlertFetch().catch((err) =>
        logger.error({ err }, "Health-Alert-Scheduler Ausnahmefehler"),
      );
    },
    60 * 60 * 1000,
  );
}

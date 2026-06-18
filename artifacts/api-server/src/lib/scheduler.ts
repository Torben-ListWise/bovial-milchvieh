/**
 * Auto-report scheduler.
 *
 * Two execution paths:
 *   1. In-process setInterval (hourly) — suitable for always-on deployments.
 *   2. External cron: POST /api/admin/cron/run-reports with the CRON_SECRET
 *      header, which calls `runScheduledReports()` directly. This allows an
 *      external scheduler (Render cron, GitHub Actions, etc.) to trigger
 *      reports without relying on the web process staying alive.
 *
 * Weekly reports: generated on Monday at 06:00 server time.
 * Monthly reports: generated on the 1st of each month at 06:00 server time.
 * Idempotent: skips if a report for the same period already exists within
 * the period window (7 days for weekly, 28 days for monthly).
 */

import { and, eq, gte } from "drizzle-orm";
import {
  db,
  datasetsTable,
  reportsTable,
  activityLogTable,
} from "@workspace/db";
import { computeDashboard } from "./compute";
import { runAgent } from "./agent";
import { logger } from "./logger";

const PERIOD_LABEL: Record<string, string> = {
  weekly: "Wochen",
  monthly: "Monats",
};

async function generateAutoReport(
  datasetId: string,
  userId: string,
  period: "weekly" | "monthly",
): Promise<void> {
  const windowMs = period === "weekly" ? 6 * 86400_000 : 28 * 86400_000;
  const [existing] = await db
    .select({ id: reportsTable.id })
    .from(reportsTable)
    .where(
      and(
        eq(reportsTable.datasetId, datasetId),
        eq(reportsTable.period, period),
        gte(reportsTable.createdAt, new Date(Date.now() - windowMs)),
      ),
    )
    .limit(1);

  if (existing) return;

  const { kpis, charts } = await computeDashboard(datasetId);

  let summary: string | null = null;
  try {
    const result = await runAgent({
      datasetId,
      conversation: [
        {
          role: "user",
          content: `Erstelle eine sachliche Zusammenfassung der wichtigsten Kennzahlen und Auffälligkeiten dieses Milchviehbetriebs für den automatischen ${PERIOD_LABEL[period] ?? ""}bericht.`,
        },
      ],
      systemExtra:
        "Antworte mit 3 bis 6 Sätzen Fließtext ohne Diagramme. Nenne konkrete Zahlen aus den Werkzeugen.",
    });
    summary = result.text || null;
  } catch (err) {
    logger.warn({ err, datasetId }, "KI-Zusammenfassung fehlgeschlagen");
  }

  const kpiLines = kpis
    .map(
      (k) =>
        `${k.label}: ${k.value ?? "—"}${k.unit ? " " + k.unit : ""}${
          k.deltaPct != null ? ` (${k.deltaPct > 0 ? "+" : ""}${k.deltaPct}%)` : ""
        }`,
    )
    .join("\n");

  const sections = [
    {
      title: "Kennzahlen im Überblick",
      content: kpiLines || "Keine berechenbaren Kennzahlen vorhanden.",
      charts,
    },
  ];

  await db.insert(reportsTable).values({
    datasetId,
    userId,
    title: `${PERIOD_LABEL[period] ?? ""}bericht ${new Date().toLocaleDateString("de-DE")}`,
    period,
    summary,
    sections,
    status: "ready",
  });

  await db.insert(activityLogTable).values({
    userId,
    type: "report",
    category: `auto_${period}`,
    datasetRef: datasetId.slice(0, 8),
  });

  logger.info({ datasetId, period }, "Automatischer Bericht erstellt");
}

/**
 * Core logic: generate weekly/monthly reports for all ready datasets.
 * Can be called from the in-process scheduler or the external cron endpoint.
 */
export async function runScheduledReports(force = false): Promise<void> {
  try {
    const now = new Date();
    const isWeekly = force || (now.getDay() === 1 && now.getHours() === 6);
    const isMonthly = force || (now.getDate() === 1 && now.getHours() === 6);

    if (!isWeekly && !isMonthly) return;

    const readyDatasets = await db
      .select({ id: datasetsTable.id, userId: datasetsTable.userId })
      .from(datasetsTable)
      .where(eq(datasetsTable.status, "ready"));

    for (const { id, userId } of readyDatasets) {
      if (isWeekly) {
        await generateAutoReport(id, userId, "weekly").catch((err) =>
          logger.warn({ err, datasetId: id }, "Wöchentlicher Auto-Bericht fehlgeschlagen"),
        );
      }
      if (isMonthly) {
        await generateAutoReport(id, userId, "monthly").catch((err) =>
          logger.warn({ err, datasetId: id }, "Monatlicher Auto-Bericht fehlgeschlagen"),
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "Scheduler-Fehler");
  }
}

/**
 * Start the in-process hourly scheduler.
 * For always-on deployments; for autoscaled environments prefer the
 * POST /api/admin/cron/run-reports external cron endpoint instead.
 */
export function startScheduler(): void {
  logger.info("Auto-Report-Scheduler gestartet (stündliche Prüfung)");
  setInterval(() => {
    runScheduledReports().catch((err) =>
      logger.error({ err }, "Scheduler-Ausnahmefehler"),
    );
  }, 60 * 60 * 1000);
}

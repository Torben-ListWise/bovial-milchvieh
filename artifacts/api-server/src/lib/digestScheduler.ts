/**
 * Monthly digest scheduler.
 *
 * Two execution paths:
 *   1. In-process setInterval (hourly check) — for always-on deployments.
 *   2. External cron: POST /api/admin/cron/run-digest with CRON_SECRET header.
 *
 * Runs on the 1st of each month at 07:00 server time.
 * Skips users who have opted out (digestOptOut = true) or have no email.
 */

import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, activityLogTable, analysisQuotaTable } from "@workspace/db";
import { logger } from "./logger";
import { sendMonthlyDigest, fireEmail } from "./emailService";

function getMonthLabel(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return prev.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

function getPrevYearMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const y = prev.getFullYear();
  const m = String(prev.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function runMonthlyDigest(): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;

  try {
    const customers = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        digestOptOut: usersTable.digestOptOut,
      })
      .from(usersTable)
      .where(eq(usersTable.role, "customer"));

    const prevYearMonth = getPrevYearMonth();
    const monthLabel = getMonthLabel();

    for (const user of customers) {
      if (!user.email || user.digestOptOut) {
        skipped++;
        continue;
      }

      try {
        const [quota] = await db
          .select({ count: analysisQuotaTable.count })
          .from(analysisQuotaTable)
          .where(
            and(
              eq(analysisQuotaTable.userId, user.id),
              eq(analysisQuotaTable.yearMonth, prevYearMonth),
            ),
          )
          .limit(1);

        const analysesThisMonth = quota?.count ?? 0;

        const [topCategoryRow] = await db
          .select({
            category: activityLogTable.category,
            cnt: sql<number>`count(*)::int`.as("cnt"),
          })
          .from(activityLogTable)
          .where(
            and(
              eq(activityLogTable.userId, user.id),
              eq(activityLogTable.type, "analysis"),
              sql`date_trunc('month', ${activityLogTable.createdAt}) = date_trunc('month', NOW() - INTERVAL '1 month')`,
            ),
          )
          .groupBy(activityLogTable.category)
          .orderBy(sql`count(*) DESC`)
          .limit(1);

        const topCategory = topCategoryRow?.category ?? null;

        fireEmail(
          sendMonthlyDigest(user.email, user.name, user.id, {
            analysesThisMonth,
            topCategory,
            month: monthLabel,
          }),
          `digest:${user.id}`,
        );

        sent++;
      } catch (err) {
        logger.warn({ err, userId: user.id }, "Digest für Nutzer fehlgeschlagen — weiter");
        skipped++;
      }
    }

    logger.info({ sent, skipped, month: prevYearMonth }, "Monatlicher Digest abgeschlossen");
  } catch (err) {
    logger.error({ err }, "runMonthlyDigest: Fehler beim Laden der Nutzer");
  }

  return { sent, skipped };
}

export function startDigestScheduler(): void {
  logger.info("Digest-Scheduler gestartet (stündliche Prüfung)");
  setInterval(() => {
    const now = new Date();
    const isDigestTime = now.getDate() === 1 && now.getHours() === 7;
    if (!isDigestTime) return;

    runMonthlyDigest().catch((err) =>
      logger.error({ err }, "Digest-Scheduler-Fehler"),
    );
  }, 60 * 60 * 1000);
}

/**
 * Dunning: daily cron job that downgrades users whose grace period has expired.
 *
 * Triggered by:
 *   1. In-process daily interval (startDunningScheduler)
 *   2. External cron: POST /api/admin/cron/run-dunning with CRON_SECRET header
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

export async function runDunningCheck(): Promise<{ downgraded: number }> {
  const now = new Date();

  // Find subscriptions with expired grace periods that are still paid plans
  const result = await db.execute(sql`
    UPDATE subscriptions
    SET plan = 'free',
        status = 'past_due_downgraded',
        stripe_subscription_id = NULL,
        stripe_price_id = NULL,
        grace_period_ends_at = NULL,
        updated_at = NOW()
    WHERE grace_period_ends_at IS NOT NULL
      AND grace_period_ends_at < ${now}
      AND plan != 'free'
    RETURNING user_id
  `);

  const count = (result as any).rowCount ?? 0;
  if (count > 0) {
    logger.info({ count }, "Dunning: Nutzer auf Free downgegradet nach abgelaufener Grace Period");
  }

  return { downgraded: count };
}

let dunningInterval: ReturnType<typeof setInterval> | null = null;

export function startDunningScheduler(): void {
  if (dunningInterval) return;

  // Run once at startup, then every 24 hours
  runDunningCheck().catch((err) =>
    logger.error({ err }, "Dunning: Initialer Check fehlgeschlagen"),
  );

  dunningInterval = setInterval(
    () => {
      runDunningCheck().catch((err) =>
        logger.error({ err }, "Dunning: Täglicher Check fehlgeschlagen"),
      );
    },
    24 * 60 * 60 * 1000,
  );
}

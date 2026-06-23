import { sql } from "drizzle-orm";
import { db, subscriptionsTable, analysisQuotaTable } from "@workspace/db";

export const PLAN_LIMITS: Record<string, number> = {
  free: 10,
  starter: 50,
  pro: Infinity,
};

export function currentYearMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function getSubscription(userId: string) {
  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(sql`${subscriptionsTable.userId} = ${userId}`)
    .limit(1);
  return sub ?? { plan: "free", status: "active", gracePeriodEndsAt: null };
}

export async function getQuotaStatus(userId: string): Promise<{
  plan: string;
  limit: number;
  used: number;
  yearMonth: string;
  periodEnd: Date | null;
  gracePeriodEndsAt: Date | null;
}> {
  const sub = await getSubscription(userId);
  const plan = sub.plan ?? "free";
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const yearMonth = currentYearMonth();

  const [quota] = await db
    .select({ count: analysisQuotaTable.count })
    .from(analysisQuotaTable)
    .where(
      sql`${analysisQuotaTable.userId} = ${userId} AND ${analysisQuotaTable.yearMonth} = ${yearMonth}`,
    )
    .limit(1);

  const used = quota?.count ?? 0;
  const periodEnd = (sub as any).currentPeriodEnd ?? null;
  const gracePeriodEndsAt = (sub as any).gracePeriodEndsAt ?? null;

  return { plan, limit, used, yearMonth, periodEnd, gracePeriodEndsAt };
}

/**
 * Atomically increments the quota counter for the current month.
 * Uses INSERT ... ON CONFLICT DO UPDATE so it works even if no row exists yet.
 */
export async function incrementQuota(userId: string): Promise<void> {
  const yearMonth = currentYearMonth();
  await db.execute(sql`
    INSERT INTO analysis_quota (user_id, year_month, count)
    VALUES (${userId}, ${yearMonth}, 1)
    ON CONFLICT (user_id, year_month)
    DO UPDATE SET count = analysis_quota.count + 1
  `);
}

/**
 * Returns true if the user is within their quota, false if they've exceeded it.
 * Does NOT increment the counter — call incrementQuota() after a successful analysis.
 */
export async function checkQuota(userId: string): Promise<{
  allowed: boolean;
  plan: string;
  limit: number;
  used: number;
}> {
  const { plan, limit, used } = await getQuotaStatus(userId);

  if (limit === Infinity) {
    return { allowed: true, plan, limit: -1, used };
  }

  return { allowed: used < limit, plan, limit, used };
}

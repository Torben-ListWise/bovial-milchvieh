import { sql, eq } from "drizzle-orm";
import { db, subscriptionsTable, analysisQuotaTable, usersTable, masterDataTable } from "@workspace/db";
import { sendQuotaWarning, fireEmail } from "./emailService";
import { logger } from "./logger";

// Credit limits per plan (monthly)
// basis: 1,99 €/Monat — 15 Credits
// starter: Professional 19 €/Monat — 60 Credits
// pro: Premium 49 €/Monat — 200 Credits
// premium_max: Premium Max 99 €/Monat — intern 1500-Credit-Soft-Limit, nach außen unbegrenzt
// beta: Testzugang — konfigurierbar (Standard 200 Credits)
export const PLAN_LIMITS: Record<string, number> = {
  free: 15,
  basis: 15,
  starter: 60,
  pro: 200,
  premium_max: Infinity,
  beta: 200,
};

// Soft fair-use-Grenze für premium_max (intern, wird nie dem Nutzer angezeigt)
export const PREMIUM_MAX_SOFT_LIMIT = 1500;

// Credit-Gewichte nach Komplexitätsstufe
export const CREDIT_WEIGHTS = {
  simple: 1,
  complex: 3,
  calculator: 5,
} as const;

export type AnalysisComplexity = keyof typeof CREDIT_WEIGHTS;

// Tools, die keine Credits kosten (reine Wissensfragen)
const KNOWLEDGE_ONLY_TOOLS = new Set(["search_knowledge", "search_web"]);
// Kalkulator-Tools (5 Credits)
const CALCULATOR_TOOLS = new Set(["calculate_investment", "calculate_semen_planning", "ask_farmer"]);
// Komplexe Analysen (3 Credits)
const COMPLEX_TOOLS = new Set([
  "get_timeseries",
  "get_group_aggregate",
  "detect_anomalies",
  "run_sql",
]);

/**
 * Klassifiziert die Komplexitätsstufe basierend auf den tatsächlich aufgerufenen Tools.
 * Gibt 0 Credits zurück für reine Wissensfragen (search_knowledge/search_web only).
 */
export function classifyComplexityFromTools(
  toolsCalled: string[],
): { complexity: AnalysisComplexity; credits: number } {
  const dataTools = toolsCalled.filter((t) => !KNOWLEDGE_ONLY_TOOLS.has(t));
  if (dataTools.length === 0) {
    return { complexity: "simple", credits: 0 };
  }
  if (dataTools.some((t) => CALCULATOR_TOOLS.has(t))) {
    return { complexity: "calculator", credits: CREDIT_WEIGHTS.calculator };
  }
  if (dataTools.some((t) => COMPLEX_TOOLS.has(t))) {
    return { complexity: "complex", credits: CREDIT_WEIGHTS.complex };
  }
  return { complexity: "simple", credits: CREDIT_WEIGHTS.simple };
}

export function currentYearMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function getBetaQuotaLimit(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: masterDataTable.value })
      .from(masterDataTable)
      .where(eq(masterDataTable.key, "beta_quota_monatlich"))
      .limit(1);
    if (row?.value) {
      const parsed = parseInt(row.value, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch (err) {
    logger.warn({ err }, "getBetaQuotaLimit: master_data lookup fehlgeschlagen, verwende Standardwert");
  }
  return PLAN_LIMITS.beta;
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

  let limit: number;
  if (plan === "beta") {
    limit = await getBetaQuotaLimit();
  } else {
    limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  }

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
 * Atomically adds `credits` to the quota counter for the current month.
 * Skips the increment when credits <= 0 (knowledge-only queries).
 */
export async function incrementQuota(userId: string, credits = 1): Promise<void> {
  if (credits <= 0) return;
  const yearMonth = currentYearMonth();
  await db.execute(sql`
    INSERT INTO analysis_quota (user_id, year_month, count)
    VALUES (${userId}, ${yearMonth}, ${credits})
    ON CONFLICT (user_id, year_month)
    DO UPDATE SET count = analysis_quota.count + ${credits}
  `);
}

/**
 * Returns true if the user is within their credit quota.
 * premium_max is always allowed (soft-limit warning only).
 */
export async function checkQuota(userId: string): Promise<{
  allowed: boolean;
  plan: string;
  limit: number;
  used: number;
}> {
  const { plan, limit, used } = await getQuotaStatus(userId);

  if (limit === Infinity) {
    if (used >= PREMIUM_MAX_SOFT_LIMIT) {
      logger.warn({ userId, used, plan }, "premium_max soft-limit überschritten");
    }
    return { allowed: true, plan, limit: -1, used };
  }

  return { allowed: used < limit, plan, limit, used };
}

/**
 * Fires a quota-warning e-mail when the user just crossed the 80 % threshold.
 * Call this after incrementQuota() completes.
 */
export async function maybeSendQuotaWarning(userId: string): Promise<void> {
  try {
    const { plan, limit, used } = await getQuotaStatus(userId);
    if (limit === Infinity || limit === 0) return;

    const threshold = Math.ceil(limit * 0.8);
    if (used !== threshold) return;

    const [user] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user?.email) return;

    fireEmail(
      sendQuotaWarning(user.email, user.name, userId, used, limit, plan),
      `quota-warning:${userId}`,
    );
  } catch (err) {
    logger.warn({ err, userId }, "maybeSendQuotaWarning fehlgeschlagen");
  }
}

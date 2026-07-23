import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { asc, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  datasetsTable,
  analysesTable,
  sourceFilesTable,
  warningsTable,
  activityLogTable,
  analysisTemplatesTable,
  messagesTable,
  knowledgeMissedQueriesTable,
  apiUsageLogTable,
  subscriptionsTable,
  creditUsageLogTable,
} from "@workspace/db";
import {
  GetAdminStatsResponse,
  GetAdminActivityResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { requireAuth, requireOperator } from "../lib/auth";
import { runScheduledReports } from "../lib/scheduler";
import { runMonthlyDigest } from "../lib/digestScheduler";
import { getCacheStats, estimateCostEur, getEffectiveModelPricing, EUR_PER_USD, MODEL_PRICING_USD_PER_1M } from "../lib/agent";

const router: IRouter = Router();

async function scalar(query: Promise<{ c: number }[]>): Promise<number> {
  const [row] = await query;
  return row?.c ?? 0;
}

router.get(
  "/admin/stats",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const customerCount = await scalar(
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(eq(usersTable.role, "customer")),
    );
    const datasetCount = await scalar(
      db.select({ c: sql<number>`count(*)::int` }).from(datasetsTable),
    );
    const analysisCount = await scalar(
      db.select({ c: sql<number>`count(*)::int` }).from(analysesTable),
    );
    const fileCount = await scalar(
      db.select({ c: sql<number>`count(*)::int` }).from(sourceFilesTable),
    );
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const analysesLast7Days = await scalar(
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(analysesTable)
        .where(gte(analysesTable.createdAt, since)),
    );
    const warningsOpen = await scalar(
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(warningsTable)
        .where(eq(warningsTable.status, "open")),
    );
    const breakdown = await db
      .select({
        category: sql<string>`coalesce(${activityLogTable.category}, 'Allgemein')`,
        count: sql<number>`count(*)::int`,
      })
      .from(activityLogTable)
      .where(eq(activityLogTable.type, "analysis"))
      .groupBy(sql`coalesce(${activityLogTable.category}, 'Allgemein')`);

    res.json(
      GetAdminStatsResponse.parse({
        customerCount,
        datasetCount,
        analysisCount,
        fileCount,
        analysesLast7Days,
        warningsOpen,
        categoryBreakdown: breakdown.map((b) => ({
          category: b.category,
          count: b.count,
        })),
      }),
    );
  },
);

router.get(
  "/admin/activity",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(activityLogTable)
      .orderBy(desc(activityLogTable.createdAt))
      .limit(100);
    res.json(
      GetAdminActivityResponse.parse(
        rows.map((a) => ({
          id: a.id,
          type: a.type,
          category: a.category ?? null,
          datasetRef: a.datasetRef ?? null,
          createdAt: a.createdAt,
        })),
      ),
    );
  },
);

function serializeTemplate(t: typeof analysisTemplatesTable.$inferSelect) {
  return {
    id: t.id,
    title: t.title,
    emoji: t.emoji,
    shortDescription: t.shortDescription,
    promptText: t.promptText,
    categoryTag: t.categoryTag ?? null,
    sortOrder: t.sortOrder,
    active: t.active,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

router.get(
  "/admin/templates",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(analysisTemplatesTable)
      .orderBy(asc(analysisTemplatesTable.sortOrder));
    res.json(rows.map(serializeTemplate));
  },
);

router.post(
  "/admin/templates",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { title, emoji, shortDescription, promptText, categoryTag, sortOrder, active } = req.body;
    if (!title || !emoji || !promptText) {
      res.status(400).json({ error: "Pflichtfelder: title, emoji, promptText" });
      return;
    }
    const [row] = await db
      .insert(analysisTemplatesTable)
      .values({
        title,
        emoji,
        shortDescription: shortDescription ?? "",
        promptText,
        categoryTag: categoryTag ?? null,
        sortOrder: sortOrder ?? 0,
        active: active !== false,
      })
      .returning();
    res.status(201).json(serializeTemplate(row));
  },
);

router.patch(
  "/admin/templates/reorder",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { items } = req.body as { items: { id: string; sortOrder: number }[] };
    if (!Array.isArray(items)) {
      res.status(400).json({ error: "items muss ein Array sein" });
      return;
    }
    await Promise.all(
      items.map(({ id, sortOrder }) =>
        db
          .update(analysisTemplatesTable)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(analysisTemplatesTable.id, id)),
      ),
    );
    res.json({ ok: true });
  },
);

router.patch(
  "/admin/templates/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { title, emoji, shortDescription, promptText, categoryTag, sortOrder, active } = req.body;
    const [row] = await db
      .select()
      .from(analysisTemplatesTable)
      .where(eq(analysisTemplatesTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Vorlage nicht gefunden" });
      return;
    }
    const [updated] = await db
      .update(analysisTemplatesTable)
      .set({
        ...(title !== undefined ? { title } : {}),
        ...(emoji !== undefined ? { emoji } : {}),
        ...(shortDescription !== undefined ? { shortDescription } : {}),
        ...(promptText !== undefined ? { promptText } : {}),
        ...(categoryTag !== undefined ? { categoryTag: categoryTag ?? null } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(active !== undefined ? { active } : {}),
        updatedAt: new Date(),
      })
      .where(eq(analysisTemplatesTable.id, id))
      .returning();
    res.json(serializeTemplate(updated));
  },
);

router.delete(
  "/admin/templates/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .select({ id: analysisTemplatesTable.id })
      .from(analysisTemplatesTable)
      .where(eq(analysisTemplatesTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Vorlage nicht gefunden" });
      return;
    }
    const [hasAnalyses] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(analysesTable)
      .where(eq(analysesTable.templateRef as any, id));
    if ((hasAnalyses?.c ?? 0) > 0) {
      await db
        .delete(messagesTable)
        .where(
          sql`${messagesTable.analysisId} IN (SELECT id FROM analyses WHERE template_ref = ${id})`,
        );
      await db
        .delete(analysesTable)
        .where(eq(analysesTable.templateRef as any, id));
    }
    await db
      .delete(analysisTemplatesTable)
      .where(eq(analysisTemplatesTable.id, id));
    res.status(204).end();
  },
);

router.get(
  "/admin/knowledge-gaps",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query["limit"] as string | undefined) ?? "50", 10), 200);
    const rows = await db.execute(
      sql`
        SELECT
          query,
          COUNT(*)::int AS frequency,
          MAX(top_score::numeric) AS max_score,
          MIN(created_at) AS first_seen,
          MAX(created_at) AS last_seen
        FROM knowledge_missed_queries
        GROUP BY query
        ORDER BY frequency DESC, last_seen DESC
        LIMIT ${limit}
      `,
    );
    res.json(
      (rows.rows as {
        query: string;
        frequency: number;
        max_score: string | null;
        first_seen: string;
        last_seen: string;
      }[]).map((r) => ({
        query: r.query,
        frequency: r.frequency,
        maxScore: r.max_score ? parseFloat(r.max_score) : null,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
      })),
    );
  },
);

// External cron trigger: POST /api/admin/cron/run-reports
// CRON_SECRET must be set — if absent the endpoint is disabled entirely to
// prevent unauthenticated job triggering (cost/abuse risk).
// Alternatively, configure the secret and call with X-Cron-Secret header.
router.post(
  "/admin/cron/run-reports",
  async (req: Request, res: Response) => {
    const cronSecret = process.env["CRON_SECRET"];
    if (!cronSecret) {
      res.status(503).json({ error: "CRON_SECRET ist nicht konfiguriert. Bitte in den Umgebungsvariablen setzen." });
      return;
    }
    const provided =
      (req.headers["x-cron-secret"] as string | undefined) ??
      (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
    if (provided !== cronSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    runScheduledReports(true).catch(() => undefined);
    res.json({ ok: true, message: "Berichtsplanung gestartet." });
  },
);

// POST /api/admin/cron/run-dunning — trigger dunning check externally
router.post(
  "/admin/cron/run-dunning",
  async (req: Request, res: Response) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      res.status(503).json({ error: "CRON_SECRET ist nicht konfiguriert." });
      return;
    }
    const provided =
      (req.headers["x-cron-secret"] as string | undefined) ??
      (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
    if (provided !== cronSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { runDunningCheck } = await import("../lib/dunning");
    const result = await runDunningCheck().catch(() => ({ downgraded: -1 }));
    res.json({ ok: true, ...result });
  },
);

// POST /api/admin/cron/run-digest — trigger monthly digest externally
router.post(
  "/admin/cron/run-digest",
  async (req: Request, res: Response) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      res.status(503).json({ error: "CRON_SECRET ist nicht konfiguriert." });
      return;
    }
    const provided =
      (req.headers["x-cron-secret"] as string | undefined) ??
      (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
    if (provided !== cronSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const result = await runMonthlyDigest().catch(() => ({ sent: -1, skipped: -1 }));
    res.json({ ok: true, ...result });
  },
);

// POST /api/admin/cron/run-thi — trigger THI batch externally
router.post(
  "/admin/cron/run-thi",
  async (req: Request, res: Response) => {
    const cronSecret = process.env["CRON_SECRET"];
    if (!cronSecret) {
      res.status(503).json({ error: "CRON_SECRET ist nicht konfiguriert." });
      return;
    }
    const provided =
      (req.headers["x-cron-secret"] as string | undefined) ??
      (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
    if (provided !== cronSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { runThiBatch } = await import("../lib/thi");
    const result = await runThiBatch().catch(() => ({ processed: -1, errors: -1 }));
    res.json({ ok: true, ...result });
  },
);

// POST /api/admin/cron/run-chips — trigger daily chip generation externally
router.post(
  "/admin/cron/run-chips",
  async (req: Request, res: Response) => {
    const cronSecret = process.env["CRON_SECRET"];
    if (!cronSecret) {
      res.status(503).json({ error: "CRON_SECRET ist nicht konfiguriert." });
      return;
    }
    const provided =
      (req.headers["x-cron-secret"] as string | undefined) ??
      (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
    if (provided !== cronSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { runDailyChipGeneration } = await import("../lib/chipScheduler");
    const result = await runDailyChipGeneration().catch(() => ({ questionsProcessed: -1, chipsGenerated: -1 }));
    res.json({ ok: true, ...result });
  },
);

// GET /api/admin/model-usage — per-model token counts and estimated cost
// Query params:
//   ?window=24h|7d|30d|all  (default: all)
router.get(
  "/admin/model-usage",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const windowParam = (req.query["window"] as string | undefined) ?? "all";
    let since: Date | null = null;
    if (windowParam === "24h") {
      since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    } else if (windowParam === "7d") {
      since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (windowParam === "30d") {
      since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    const [rows, { pricing }] = await Promise.all([
      db
        .select({
          model: apiUsageLogTable.modelUsed,
          calls: sql<number>`count(*)::int`,
          inputTokens: sql<number>`coalesce(sum(${apiUsageLogTable.inputTokens}), 0)::bigint`,
          outputTokens: sql<number>`coalesce(sum(${apiUsageLogTable.outputTokens}), 0)::bigint`,
        })
        .from(apiUsageLogTable)
        .where(since ? gte(apiUsageLogTable.createdAt, since) : sql`true`)
        .groupBy(apiUsageLogTable.modelUsed)
        .orderBy(desc(sql`count(*)`)),
      getEffectiveModelPricing(),
    ]);

    res.json(
      rows.map((r) => ({
        model: r.model,
        calls: Number(r.calls),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        estimatedCostEur: estimateCostEur(
          r.model,
          Number(r.inputTokens),
          Number(r.outputTokens),
          pricing,
        ),
        window: windowParam,
      })),
    );
  },
);

// GET /api/admin/pricing-config — current effective model pricing and its source
router.get(
  "/admin/pricing-config",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const { pricing, source } = await getEffectiveModelPricing();
    res.json({
      source,
      eurPerUsd: EUR_PER_USD,
      hardcodedPricing: MODEL_PRICING_USD_PER_1M,
      effectivePricing: pricing,
    });
  },
);

// GET /api/admin/cache-stats — prompt-cache hit/miss counters
// Query params:
//   ?window=24h|7d|30d|all  (default: all)
// The DB aggregate survives server restarts; the in-memory snapshot is also
// included for the current session (since last restart).
router.get(
  "/admin/cache-stats",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const windowParam = (req.query["window"] as string | undefined) ?? "all";
    let since: Date | null = null;
    if (windowParam === "24h") {
      since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    } else if (windowParam === "7d") {
      since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (windowParam === "30d") {
      since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    const [dbRow] = await db
      .select({
        totalCalls: sql<number>`count(*)::int`,
        totalInputTokens: sql<number>`coalesce(sum(input_tokens), 0)::bigint`,
        totalOutputTokens: sql<number>`coalesce(sum(output_tokens), 0)::bigint`,
        totalCacheCreationTokens: sql<number>`coalesce(sum(cache_creation_tokens), 0)::bigint`,
        totalCacheReadTokens: sql<number>`coalesce(sum(cache_read_tokens), 0)::bigint`,
        firstRecordedAt: sql<string | null>`min(created_at)`,
        lastRecordedAt: sql<string | null>`max(created_at)`,
      })
      .from(apiUsageLogTable)
      .where(since ? gte(apiUsageLogTable.createdAt, since) : sql`true`);

    const dbStats = dbRow ?? {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      firstRecordedAt: null,
      lastRecordedAt: null,
    };

    const totalCache =
      Number(dbStats.totalCacheReadTokens) +
      Number(dbStats.totalCacheCreationTokens);
    const hitRatePct =
      totalCache > 0
        ? Math.round(
            (Number(dbStats.totalCacheReadTokens) / totalCache) * 10000,
          ) / 100
        : null;

    const memStats = getCacheStats();

    res.json({
      window: windowParam,
      db: {
        totalCalls: Number(dbStats.totalCalls),
        totalInputTokens: Number(dbStats.totalInputTokens),
        totalOutputTokens: Number(dbStats.totalOutputTokens),
        totalCacheCreationTokens: Number(dbStats.totalCacheCreationTokens),
        totalCacheReadTokens: Number(dbStats.totalCacheReadTokens),
        hitRatePct,
        firstRecordedAt: dbStats.firstRecordedAt,
        lastRecordedAt: dbStats.lastRecordedAt,
      },
      currentSession: {
        ...memStats,
        hitRatePct:
          memStats.totalCalls > 0
            ? Math.round(
                (memStats.totalCacheReadTokens /
                  (memStats.totalCacheReadTokens +
                    memStats.totalCacheCreationTokens || 1)) *
                  10000,
              ) / 100
            : null,
      },
    });
  },
);

// POST /api/admin/beta/assign — assign beta plan to a registered user by email
router.post(
  "/admin/beta/assign",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { email } = req.body as { email?: string };
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "E-Mail-Adresse erforderlich" });
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();

    const [targetUser] = await db
      .select()
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${normalizedEmail}`)
      .limit(1);

    if (!targetUser) {
      res.status(404).json({ error: "Nutzer nicht gefunden. Der Account muss bereits registriert sein." });
      return;
    }

    await db.execute(sql`
      INSERT INTO subscriptions (user_id, plan, status, updated_at)
      VALUES (${targetUser.id}, 'beta', 'active', NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET plan = 'beta', status = 'active', updated_at = NOW()
    `);

    await db.insert(activityLogTable).values({
      userId: req.userId!,
      type: "beta_assign",
      category: "Operator",
      datasetRef: targetUser.id.slice(0, 8),
    } as any);

    res.json({ ok: true, userId: targetUser.id, email: targetUser.email, plan: "beta" });
  },
);

// POST /api/admin/plan/assign — assign any plan to a registered user by email
//
// Two auth forms are accepted:
//
// 1. Machine-auth (no browser session required) — use CRON_SECRET:
//      curl -X POST https://<host>/api/admin/plan/assign \
//        -H "Authorization: Bearer <CRON_SECRET>" \
//        -H "Content-Type: application/json" \
//        -d '{"email":"farmer@example.com","plan":"pro"}'
//    The X-Cron-Secret header is accepted as an alternative to Authorization.
//
// 2. Browser-auth — standard Clerk operator JWT (existing behaviour unchanged).
router.post(
  "/admin/plan/assign",
  async (req: Request, res: Response, next: NextFunction) => {
    const cronSecret = process.env["CRON_SECRET"];
    const provided =
      (req.headers["x-cron-secret"] as string | undefined) ??
      (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "");
    if (cronSecret && provided === cronSecret) {
      req.userId = "system";
      req.appUser = { id: "system", email: null, name: null, role: "operator" } as any;
      return next();
    }
    await requireAuth(req, res, () => requireOperator(req, res, next));
  },
  async (req: Request, res: Response) => {
    const { email, plan } = req.body as { email?: string; plan?: string };
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "E-Mail-Adresse erforderlich" });
      return;
    }
    const VALID_PLANS = ["free", "starter", "beta", "pro"] as const;
    type ValidPlan = (typeof VALID_PLANS)[number];
    if (!plan || !VALID_PLANS.includes(plan as ValidPlan)) {
      res.status(400).json({ error: `Plan muss einer der folgenden Werte sein: ${VALID_PLANS.join(", ")}` });
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const validPlan = plan as ValidPlan;
    const [targetUser] = await db
      .select()
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${normalizedEmail}`)
      .limit(1);

    if (!targetUser) {
      res.status(404).json({ error: "Nutzer nicht gefunden. Der Account muss bereits registriert sein." });
      return;
    }

    await db.execute(sql`
      INSERT INTO subscriptions (user_id, plan, status, updated_at)
      VALUES (${targetUser.id}, ${validPlan}, 'active', NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET plan = ${validPlan}, status = 'active', updated_at = NOW()
    `);

    await db.insert(activityLogTable).values({
      userId: req.userId!,
      type: "plan_assign",
      category: "Operator",
      datasetRef: targetUser.id.slice(0, 8),
    } as any);

    res.json({ ok: true, userId: targetUser.id, email: targetUser.email, plan: validPlan });
  },
);

// GET /api/admin/billing — operator view of all user plans
router.get(
  "/admin/billing",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(sql`
      SELECT
        u.id as user_id,
        u.email,
        u.name,
        COALESCE(s.plan, 'free') as plan,
        COALESCE(s.status, 'active') as status,
        s.stripe_customer_id,
        s.current_period_end,
        s.grace_period_ends_at,
        COALESCE(q.count, 0) as analyses_this_month
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id
      LEFT JOIN analysis_quota q ON q.user_id = u.id
        AND q.year_month = TO_CHAR(NOW(), 'YYYY-MM')
      WHERE u.role = 'customer'
      ORDER BY u.email
    `);
    res.json((rows as any).rows ?? rows);
  },
);

// ── GET /api/admin/credit-usage ──────────────────────────────────────────────
// Operator-Dashboard: Credit-Verbrauch mit Aggregaten und Ausreißer-Markierung
router.get(
  "/admin/credit-usage",
  requireOperator,
  async (req: Request, res: Response) => {
    try {
      const limit = Math.min(200, parseInt(req.query.limit as string) || 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const filterUserId = req.query.userId as string | undefined;
      const filterComplexity = req.query.complexity as string | undefined;

      // ── Recent entries ────────────────────────────────────────────────────
      const conditions: string[] = ["1=1"];
      const params: unknown[] = [];

      if (filterUserId) {
        params.push(filterUserId);
        conditions.push(`c.user_id = $${params.length}`);
      }
      if (filterComplexity) {
        params.push(filterComplexity);
        conditions.push(`c.complexity = $${params.length}`);
      }

      const whereClause = conditions.join(" AND ");

      const entriesResult = await db.execute(sql.raw(`
        SELECT
          c.id,
          c.analysis_id AS "analysisId",
          c.user_id AS "userId",
          c.dataset_id AS "datasetId",
          c.complexity,
          c.credits,
          c.tools_called AS "toolsCalled",
          c.input_tokens AS "inputTokens",
          c.output_tokens AS "outputTokens",
          c.api_cost_millicents AS "apiCostMillicents",
          c.plan,
          c.created_at AS "createdAt",
          u.name AS "userName",
          u.email AS "userEmail"
        FROM credit_usage_log c
        LEFT JOIN users u ON u.id = c.user_id
        WHERE ${whereClause}
        ORDER BY c.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `));
      const entries = (entriesResult as any).rows ?? entriesResult;

      const totalResult = await db.execute(sql.raw(`
        SELECT COUNT(*) AS total FROM credit_usage_log c WHERE ${whereClause}
      `));
      const total = parseInt(((totalResult as any).rows ?? totalResult)[0]?.total ?? "0", 10);

      // ── Aggregates by complexity ──────────────────────────────────────────
      const aggResult = await db.execute(sql`
        SELECT
          complexity,
          COUNT(*) AS count,
          ROUND(AVG(credits), 2) AS "avgCredits",
          ROUND(AVG(api_cost_millicents), 0) AS "avgApiCostMillicents",
          SUM(credits) AS "totalCredits",
          SUM(api_cost_millicents) AS "totalApiCostMillicents"
        FROM credit_usage_log
        GROUP BY complexity
        ORDER BY "avgApiCostMillicents" DESC
      `);
      const byComplexity = (aggResult as any).rows ?? aggResult;

      // ── Per-user totals this month ────────────────────────────────────────
      const yearMonth = new Date().toISOString().slice(0, 7);
      const userResult = await db.execute(sql.raw(`
        SELECT
          c.user_id AS "userId",
          u.name AS "userName",
          u.email AS "userEmail",
          SUM(c.credits) AS "totalCredits",
          SUM(c.api_cost_millicents) AS "totalApiCostMillicents",
          COUNT(*) AS "requestCount"
        FROM credit_usage_log c
        LEFT JOIN users u ON u.id = c.user_id
        WHERE c.created_at >= '${yearMonth}-01'
        GROUP BY c.user_id, u.name, u.email
        ORDER BY "totalCredits" DESC
        LIMIT 50
      `));
      const byUser = (userResult as any).rows ?? userResult;

      // ── Outlier detection ─────────────────────────────────────────────────
      // An entry is flagged when its API cost is >= 2× the average for its
      // complexity class — suggesting the complexity label may be too low.
      const avgByComplexity: Record<string, number> = {};
      for (const row of byComplexity as any[]) {
        avgByComplexity[row.complexity] = parseFloat(row.avgApiCostMillicents ?? "0");
      }

      const outlierResult = await db.execute(sql`
        SELECT
          c.id,
          c.analysis_id AS "analysisId",
          c.user_id AS "userId",
          c.complexity,
          c.credits,
          c.tools_called AS "toolsCalled",
          c.input_tokens AS "inputTokens",
          c.output_tokens AS "outputTokens",
          c.api_cost_millicents AS "apiCostMillicents",
          c.created_at AS "createdAt",
          u.name AS "userName"
        FROM credit_usage_log c
        LEFT JOIN users u ON u.id = c.user_id
        WHERE c.api_cost_millicents > 0
        ORDER BY c.api_cost_millicents DESC
        LIMIT 200
      `);
      const allForOutlier = (outlierResult as any).rows ?? outlierResult;

      const outliers: unknown[] = [];
      for (const row of allForOutlier as any[]) {
        const avg = avgByComplexity[row.complexity] ?? 0;
        if (avg > 0 && row.apiCostMillicents > avg * 2.0) {
          outliers.push({
            ...row,
            avgForComplexity: avg,
            costRatio: (row.apiCostMillicents / avg).toFixed(2),
          });
        }
        if (outliers.length >= 20) break;
      }

      res.json({
        entries,
        total,
        byComplexity,
        byUser,
        outliers,
        meta: {
          limit,
          offset,
          filterUserId: filterUserId ?? null,
          filterComplexity: filterComplexity ?? null,
          currentYearMonth: yearMonth,
        },
      });
    } catch (err) {
      logger.error({ err }, "admin/credit-usage failed");
      res.status(500).json({ error: "Fehler beim Laden der Credit-Nutzungsdaten" });
    }
  },
);

// POST /api/admin/cron/run-health-alerts — Amtliche Tierseuchen-Warnungen fetchen
router.post(
  "/admin/cron/run-health-alerts",
  async (req: Request, res: Response) => {
    const cronSecret = process.env["CRON_SECRET"];
    if (!cronSecret) {
      res.status(503).json({ error: "CRON_SECRET ist nicht konfiguriert." });
      return;
    }
    const provided =
      (req.headers["x-cron-secret"] as string | undefined) ??
      (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
    if (provided !== cronSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { runHealthAlertFetch } = await import("../lib/healthAlertScheduler");
    const result = await runHealthAlertFetch().catch(() => ({ fetched: -1, inserted: -1, skipped: -1 }));
    res.json({ ok: true, ...result });
  },
);

// POST /api/admin/cron/run-knowledge-gaps — Wöchentlicher Wissenslücken-Bericht
router.post(
  "/admin/cron/run-knowledge-gaps",
  async (req: Request, res: Response) => {
    const cronSecret = process.env["CRON_SECRET"];
    if (!cronSecret) {
      res.status(503).json({ error: "CRON_SECRET ist nicht konfiguriert." });
      return;
    }
    const provided =
      (req.headers["x-cron-secret"] as string | undefined) ??
      (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
    if (provided !== cronSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { runKnowledgeGapsReport } = await import("../lib/knowledgeGapsBatch");
    const result = await runKnowledgeGapsReport().catch(() => ({
      queriesAnalysed: -1,
      uniqueGaps: -1,
      emailSent: false,
    }));
    res.json({ ok: true, ...result });
  },
);

// ── GET /api/admin/bi-dashboard ──────────────────────────────────────────────
// Business-Intelligence-Überblick: Tool-Nutzung, Chip-Kategorien, Plan-Verteilung,
// Wochenaktivität pro Betrieb, Abwanderungs-Frühwarnung.
router.get(
  "/admin/bi-dashboard",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    try {
      // 1) Top-10 Tools aus beta_tool_logs
      const toolsResult = await db.execute(sql`
        SELECT tool_name AS "toolName", COUNT(*)::int AS count
        FROM beta_tool_logs
        GROUP BY tool_name
        ORDER BY count DESC
        LIMIT 10
      `);
      const topTools = (toolsResult as any).rows ?? toolsResult;

      // 2) Top-10 Chip-Kategorien der letzten 90 Tage
      const chipsResult = await db.execute(sql`
        SELECT category, COUNT(*)::int AS count
        FROM daily_chip_suggestions
        WHERE valid_date >= (CURRENT_DATE - INTERVAL '90 days')
        GROUP BY category
        ORDER BY count DESC
        LIMIT 10
      `);
      const topChipCategories = (chipsResult as any).rows ?? chipsResult;

      // 3) Plan-Verteilung (aktive Kunden)
      const planResult = await db.execute(sql`
        SELECT
          COALESCE(s.plan, 'free') AS plan,
          COUNT(*)::int AS "userCount"
        FROM users u
        LEFT JOIN subscriptions s ON s.user_id = u.id
        WHERE u.role = 'customer'
        GROUP BY COALESCE(s.plan, 'free')
        ORDER BY "userCount" DESC
      `);
      const planDistribution = (planResult as any).rows ?? planResult;

      // 4) Analysen pro Betrieb pro Woche (letzte 8 Wochen)
      const weeklyResult = await db.execute(sql`
        SELECT
          u.id AS "userId",
          COALESCE(u.name, u.email) AS "userName",
          TO_CHAR(DATE_TRUNC('week', a.created_at), 'YYYY-WW') AS week,
          COUNT(*)::int AS analyses
        FROM analyses a
        JOIN users u ON u.id = a.user_id
        WHERE a.created_at >= NOW() - INTERVAL '8 weeks'
          AND u.role = 'customer'
        GROUP BY u.id, week
        ORDER BY "userId", week
      `);
      const weeklyActivity = (weeklyResult as any).rows ?? weeklyResult;

      // 5) Abwanderungs-Frühwarnung: letzte 14 Tage vs. 14 Tage davor
      const churnResult = await db.execute(sql`
        WITH recent AS (
          SELECT user_id, COUNT(*) AS cnt
          FROM analyses
          WHERE created_at >= NOW() - INTERVAL '14 days'
            AND user_id IN (SELECT id FROM users WHERE role = 'customer')
          GROUP BY user_id
        ),
        prior AS (
          SELECT user_id, COUNT(*) AS cnt
          FROM analyses
          WHERE created_at >= NOW() - INTERVAL '28 days'
            AND created_at < NOW() - INTERVAL '14 days'
            AND user_id IN (SELECT id FROM users WHERE role = 'customer')
          GROUP BY user_id
        )
        SELECT
          p.user_id AS "userId",
          COALESCE(u.name, u.email) AS "userName",
          u.email AS "userEmail",
          p.cnt::int AS "priorCount",
          COALESCE(r.cnt, 0)::int AS "recentCount",
          ROUND((1 - COALESCE(r.cnt, 0)::numeric / NULLIF(p.cnt, 0)) * 100) AS "dropPercent"
        FROM prior p
        LEFT JOIN recent r ON r.user_id = p.user_id
        JOIN users u ON u.id = p.user_id
        WHERE p.cnt >= 3
          AND COALESCE(r.cnt, 0)::numeric / NULLIF(p.cnt, 0) < 0.5
        ORDER BY "dropPercent" DESC
        LIMIT 20
      `);
      const churnRisk = (churnResult as any).rows ?? churnResult;

      res.json({ topTools, topChipCategories, planDistribution, weeklyActivity, churnRisk });
    } catch (err) {
      logger.error({ err }, "admin/bi-dashboard fehlgeschlagen");
      res.status(500).json({ error: "Interner Fehler" });
    }
  },
);

// ── GET /api/admin/credit-margin ─────────────────────────────────────────────
// Margenanalyse pro Preisplan: Einnahmen vs. tatsächliche API-Kosten diesen Monat.
router.get(
  "/admin/credit-margin",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    try {
      const PLAN_PRICES: Record<string, number> = {
        basis: 1.99,
        starter: 19.0,
        pro: 49.0,
        premium_max: 99.0,
        free: 0,
        beta: 0,
      };

      const yearMonth = new Date().toISOString().slice(0, 7);

      // Per-plan: Nutzeranzahl + API-Kosten diesen Monat
      const result = await db.execute(sql.raw(`
        SELECT
          COALESCE(s.plan, 'free') AS plan,
          COUNT(DISTINCT u.id)::int AS "activeUsers",
          COALESCE(SUM(c.api_cost_millicents), 0)::bigint AS "totalApiCostMillicents",
          COALESCE(AVG(user_costs.user_mc), 0) AS "avgApiCostMillicentsPerUser"
        FROM users u
        LEFT JOIN subscriptions s ON s.user_id = u.id
        LEFT JOIN credit_usage_log c ON c.user_id = u.id
          AND c.created_at >= '${yearMonth}-01'
        LEFT JOIN (
          SELECT user_id, SUM(api_cost_millicents) AS user_mc
          FROM credit_usage_log
          WHERE created_at >= '${yearMonth}-01'
          GROUP BY user_id
        ) user_costs ON user_costs.user_id = u.id
        WHERE u.role = 'customer'
        GROUP BY COALESCE(s.plan, 'free')
        ORDER BY "activeUsers" DESC
      `));
      const rows = (result as any).rows ?? result;

      const margins = rows.map((r: any) => {
        const plan = r.plan as string;
        const priceEur = PLAN_PRICES[plan] ?? 0;
        const activeUsers = parseInt(r.activeUsers ?? "0", 10);
        const monthlyRevenueEur = priceEur * activeUsers;
        const totalApiCostEur = parseInt(r.totalApiCostMillicents ?? "0", 10) / 100_000;
        const avgApiCostEurPerUser = parseFloat(r.avgApiCostMillicentsPerUser ?? "0") / 100_000;
        const marginEur = monthlyRevenueEur - totalApiCostEur;
        const marginPct = monthlyRevenueEur > 0
          ? Math.round((marginEur / monthlyRevenueEur) * 100)
          : null;
        return {
          plan,
          priceEur,
          activeUsers,
          monthlyRevenueEur: parseFloat(monthlyRevenueEur.toFixed(2)),
          totalApiCostEur: parseFloat(totalApiCostEur.toFixed(4)),
          avgApiCostEurPerUser: parseFloat(avgApiCostEurPerUser.toFixed(4)),
          marginEur: parseFloat(marginEur.toFixed(2)),
          marginPct,
        };
      });

      res.json({ margins, yearMonth });
    } catch (err) {
      logger.error({ err }, "admin/credit-margin fehlgeschlagen");
      res.status(500).json({ error: "Interner Fehler" });
    }
  },
);

export default router;

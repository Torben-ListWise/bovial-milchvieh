import { Router, type IRouter, type Request, type Response } from "express";
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
} from "@workspace/db";
import {
  GetAdminStatsResponse,
  GetAdminActivityResponse,
} from "@workspace/api-zod";
import { requireAuth, requireOperator } from "../lib/auth";
import { runScheduledReports } from "../lib/scheduler";
import { runMonthlyDigest } from "../lib/digestScheduler";

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

export default router;

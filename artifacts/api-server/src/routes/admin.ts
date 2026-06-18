import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  datasetsTable,
  analysesTable,
  sourceFilesTable,
  warningsTable,
  activityLogTable,
} from "@workspace/db";
import {
  GetAdminStatsResponse,
  GetAdminActivityResponse,
} from "@workspace/api-zod";
import { requireAuth, requireOperator } from "../lib/auth";

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

export default router;

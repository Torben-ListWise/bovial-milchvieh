import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, lte, isNull, sql } from "drizzle-orm";
import { db, farmDiaryEntriesTable, usersTable } from "@workspace/db";
import { requireAuth, requireOperator } from "../lib/auth";

const router: IRouter = Router();

const CATEGORY_DE: Record<string, string> = {
  feed: "Fütterung",
  infrastructure: "Infrastruktur",
  health: "Tiergesundheit",
  management: "Betriebsführung",
  weather: "Wetter",
  other: "Sonstiges",
};

router.get("/diary", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const days = Math.min(parseInt((req.query.days as string) ?? "30", 10), 365);
  const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 100);

  const entries = await db
    .select()
    .from(farmDiaryEntriesTable)
    .where(
      and(
        eq(farmDiaryEntriesTable.userId, userId),
        sql`entry_date >= CURRENT_DATE - INTERVAL '${sql.raw(String(days))} days'`,
      ),
    )
    .orderBy(desc(farmDiaryEntriesTable.entryDate))
    .limit(limit);

  res.json(entries);
});

router.get("/diary/reminders", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;

  const entries = await db
    .select()
    .from(farmDiaryEntriesTable)
    .where(
      and(
        eq(farmDiaryEntriesTable.userId, userId),
        lte(farmDiaryEntriesTable.reminderDueAt, new Date()),
        isNull(farmDiaryEntriesTable.remindedAt),
        sql`entry_date >= CURRENT_DATE - INTERVAL '60 days'`,
      ),
    )
    .orderBy(asc(farmDiaryEntriesTable.reminderDueAt))
    .limit(5);

  const result = entries.map((e) => {
    const daysAgo = Math.floor(
      (Date.now() - new Date(e.entryDate + "T12:00:00Z").getTime()) / 86_400_000,
    );
    return {
      id: e.id,
      description: e.description,
      entryDate: e.entryDate,
      category: e.category,
      daysAgo,
    };
  });

  res.json(result);
});

router.patch("/diary/:id/reminded", requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = req.userId!;

  const [entry] = await db
    .select({ id: farmDiaryEntriesTable.id })
    .from(farmDiaryEntriesTable)
    .where(
      and(eq(farmDiaryEntriesTable.id, id), eq(farmDiaryEntriesTable.userId, userId)),
    );

  if (!entry) {
    res.status(404).json({ error: "Eintrag nicht gefunden" });
    return;
  }

  await db
    .update(farmDiaryEntriesTable)
    .set({ remindedAt: new Date() })
    .where(eq(farmDiaryEntriesTable.id, id));

  res.json({ ok: true });
});

router.get("/admin/diary", requireAuth, requireOperator, async (req: Request, res: Response) => {
  const filterUserId = req.query.userId as string | undefined;
  const filterCategory = req.query.category as string | undefined;

  const conditions = [];
  if (filterUserId) {
    conditions.push(eq(farmDiaryEntriesTable.userId, filterUserId));
  }
  if (filterCategory) {
    conditions.push(eq(farmDiaryEntriesTable.category, filterCategory));
  }

  const entries = await db
    .select({
      id: farmDiaryEntriesTable.id,
      userId: farmDiaryEntriesTable.userId,
      analysisId: farmDiaryEntriesTable.analysisId,
      entryDate: farmDiaryEntriesTable.entryDate,
      category: farmDiaryEntriesTable.category,
      description: farmDiaryEntriesTable.description,
      reminderDays: farmDiaryEntriesTable.reminderDays,
      reminderDueAt: farmDiaryEntriesTable.reminderDueAt,
      remindedAt: farmDiaryEntriesTable.remindedAt,
      createdAt: farmDiaryEntriesTable.createdAt,
      userEmail: usersTable.email,
      userName: usersTable.name,
    })
    .from(farmDiaryEntriesTable)
    .innerJoin(usersTable, eq(farmDiaryEntriesTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(farmDiaryEntriesTable.entryDate));

  const result = entries.map((e) => ({
    id: e.id,
    entryDate: e.entryDate,
    category: e.category,
    categoryLabel: CATEGORY_DE[e.category] ?? e.category,
    description: e.description,
    reminderDays: e.reminderDays,
    reminderDueAt: e.reminderDueAt,
    remindedAt: e.remindedAt,
    createdAt: e.createdAt,
    user: {
      id: e.userId,
      email: e.userEmail,
      name: e.userName,
    },
  }));

  res.json(result);
});

export default router;

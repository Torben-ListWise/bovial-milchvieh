import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db, newsEditionsTable } from "@workspace/db";
import { requireAuth, requireOperator } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Customer routes ───────────────────────────────────────────────────────────

router.get("/news/latest", requireAuth, async (_req: Request, res: Response) => {
  const [edition] = await db
    .select({
      id: newsEditionsTable.id,
      title: newsEditionsTable.title,
      teaser: newsEditionsTable.teaser,
      topicBadges: newsEditionsTable.topicBadges,
      publishedAt: newsEditionsTable.publishedAt,
    })
    .from(newsEditionsTable)
    .where(eq(newsEditionsTable.status, "published"))
    .orderBy(desc(newsEditionsTable.publishedAt))
    .limit(1);

  res.json(edition ?? null);
});

router.get("/news/latest/full", requireAuth, async (_req: Request, res: Response) => {
  const [edition] = await db
    .select({
      id: newsEditionsTable.id,
      title: newsEditionsTable.title,
      teaser: newsEditionsTable.teaser,
      bodyMarkdown: newsEditionsTable.bodyMarkdown,
      topicBadges: newsEditionsTable.topicBadges,
      publishedAt: newsEditionsTable.publishedAt,
    })
    .from(newsEditionsTable)
    .where(eq(newsEditionsTable.status, "published"))
    .orderBy(desc(newsEditionsTable.publishedAt))
    .limit(1);

  res.json(edition ?? null);
});

// ── Operator routes ───────────────────────────────────────────────────────────

router.get(
  "/operator/news",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const editions = await db
      .select()
      .from(newsEditionsTable)
      .orderBy(desc(newsEditionsTable.createdAt));
    res.json(editions);
  },
);

router.post(
  "/operator/news",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { title, teaser, bodyMarkdown, topicBadges } = req.body as {
      title: string;
      teaser?: string;
      bodyMarkdown?: string;
      topicBadges?: string[];
    };

    if (!title?.trim()) {
      res.status(400).json({ error: "Titel ist erforderlich" });
      return;
    }

    const [created] = await db
      .insert(newsEditionsTable)
      .values({ title: title.trim(), teaser, bodyMarkdown, topicBadges, status: "draft" })
      .returning();

    logger.info({ id: created.id }, "Nachrichtenausgabe erstellt");
    res.status(201).json(created);
  },
);

router.put(
  "/operator/news/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const [existing] = await db
      .select({ status: newsEditionsTable.status })
      .from(newsEditionsTable)
      .where(eq(newsEditionsTable.id, id));

    if (!existing) {
      res.status(404).json({ error: "Ausgabe nicht gefunden" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(409).json({ error: "Veröffentlichte Ausgaben können nicht bearbeitet werden" });
      return;
    }

    const { title, teaser, bodyMarkdown, topicBadges } = req.body as {
      title?: string;
      teaser?: string;
      bodyMarkdown?: string;
      topicBadges?: string[];
    };

    const [updated] = await db
      .update(newsEditionsTable)
      .set({ title: title?.trim(), teaser, bodyMarkdown, topicBadges })
      .where(eq(newsEditionsTable.id, id))
      .returning();

    res.json(updated);
  },
);

router.post(
  "/operator/news/:id/publish",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const [existing] = await db
      .select({ status: newsEditionsTable.status })
      .from(newsEditionsTable)
      .where(eq(newsEditionsTable.id, id));

    if (!existing) {
      res.status(404).json({ error: "Ausgabe nicht gefunden" });
      return;
    }
    if (existing.status === "published") {
      res.status(409).json({ error: "Ausgabe ist bereits veröffentlicht" });
      return;
    }

    const [updated] = await db
      .update(newsEditionsTable)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(newsEditionsTable.id, id))
      .returning();

    logger.info({ id }, "Nachrichtenausgabe veröffentlicht");
    res.json(updated);
  },
);

router.delete(
  "/operator/news/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const [existing] = await db
      .select({ status: newsEditionsTable.status })
      .from(newsEditionsTable)
      .where(eq(newsEditionsTable.id, id));

    if (!existing) {
      res.status(404).json({ error: "Ausgabe nicht gefunden" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(409).json({ error: "Nur Entwürfe können gelöscht werden" });
      return;
    }

    await db.delete(newsEditionsTable).where(eq(newsEditionsTable.id, id));
    res.status(204).end();
  },
);

export default router;

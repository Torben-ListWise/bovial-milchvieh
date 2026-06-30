import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, newsEditionsTable, newsTopicsTable, newsletterEditionsTable } from "@workspace/db";
import { requireAuth, requireOperator } from "../lib/auth";
import { logger } from "../lib/logger";
import { runNewsWeeklyBatch } from "../lib/newsWeeklyBatch";

const router: IRouter = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function verifyCronSecret(req: Request, res: Response): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) {
    res.status(503).json({ error: "CRON_SECRET nicht konfiguriert" });
    return false;
  }
  const provided =
    req.headers["x-cron-secret"] ??
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    res.status(401).json({ error: "Ungültiges Cron-Secret" });
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEWSLETTER EDITIONS — Customer routes
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /news/newsletter/current
 * Returns the latest approved edition whose scheduledDate ≤ today.
 * Never leaks drafts or rejected editions.
 */
router.get(
  "/news/newsletter/current",
  requireAuth,
  async (_req: Request, res: Response) => {
    const today = todayStr();
    const [edition] = await db
      .select()
      .from(newsletterEditionsTable)
      .where(
        and(
          eq(newsletterEditionsTable.status, "approved"),
          lte(newsletterEditionsTable.scheduledDate, today),
        ),
      )
      .orderBy(desc(newsletterEditionsTable.scheduledDate))
      .limit(1);

    res.json(edition ?? null);
  },
);

/**
 * GET /news/newsletter/archive
 * Returns all approved editions ordered by scheduledDate desc.
 * Excludes the current (first) one — callers concat themselves.
 */
router.get(
  "/news/newsletter/archive",
  requireAuth,
  async (_req: Request, res: Response) => {
    const today = todayStr();
    const editions = await db
      .select({
        id: newsletterEditionsTable.id,
        scheduledDate: newsletterEditionsTable.scheduledDate,
        topic: newsletterEditionsTable.topic,
        topicColor: newsletterEditionsTable.topicColor,
        title: newsletterEditionsTable.title,
        status: newsletterEditionsTable.status,
      })
      .from(newsletterEditionsTable)
      .where(
        and(
          eq(newsletterEditionsTable.status, "approved"),
          lte(newsletterEditionsTable.scheduledDate, today),
        ),
      )
      .orderBy(desc(newsletterEditionsTable.scheduledDate))
      .limit(50);

    res.json(editions);
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// NEWSLETTER EDITIONS — Operator routes
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /operator/newsletter
 * List editions. Optional ?week=YYYY-MM-DD filters to the week containing that date.
 * Without ?week returns the last 60 editions ordered by scheduledDate desc.
 */
/** Snap any date to its Monday (ISO week start). */
function toMonday(isoDate: string): string {
  const d = new Date(isoDate);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow; // Mon=0 offset
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

router.get(
  "/operator/newsletter",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const week = req.query.week as string | undefined;
    let editions;

    if (week) {
      // Always snap to Monday so the 7-day window aligns with batch generation
      const monday = toMonday(week);
      const base = new Date(monday);
      base.setHours(0, 0, 0, 0);
      const end = new Date(base);
      end.setDate(base.getDate() + 6);
      editions = await db
        .select()
        .from(newsletterEditionsTable)
        .where(
          and(
            gte(newsletterEditionsTable.scheduledDate, monday),
            lte(newsletterEditionsTable.scheduledDate, end.toISOString().slice(0, 10)),
          ),
        )
        .orderBy(asc(newsletterEditionsTable.scheduledDate));
    } else {
      editions = await db
        .select()
        .from(newsletterEditionsTable)
        .orderBy(desc(newsletterEditionsTable.scheduledDate))
        .limit(60);
    }

    res.json(editions);
  },
);

/**
 * PUT /operator/newsletter/:id
 * Update a draft edition. Only drafts can be edited.
 */
router.put(
  "/operator/newsletter/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const [existing] = await db
      .select({ status: newsletterEditionsTable.status })
      .from(newsletterEditionsTable)
      .where(eq(newsletterEditionsTable.id, id));

    if (!existing) {
      res.status(404).json({ error: "Ausgabe nicht gefunden" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(409).json({
        error: "Nur Entwürfe können bearbeitet werden",
      });
      return;
    }

    const { title, appBody, socialBody, ctaType, ctaTarget } = req.body as {
      title?: string;
      appBody?: string;
      socialBody?: string;
      ctaType?: string;
      ctaTarget?: string;
    };

    const [updated] = await db
      .update(newsletterEditionsTable)
      .set({
        ...(title ? { title: title.trim() } : {}),
        ...(appBody !== undefined ? { appBody } : {}),
        ...(socialBody !== undefined ? { socialBody } : {}),
        ...(ctaType ? { ctaType } : {}),
        ...(ctaTarget !== undefined ? { ctaTarget } : {}),
      })
      .where(eq(newsletterEditionsTable.id, id))
      .returning();

    res.json(updated);
  },
);

/**
 * POST /operator/newsletter/:id/approve
 * Approve a draft edition (status → "approved").
 */
router.post(
  "/operator/newsletter/:id/approve",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const [existing] = await db
      .select({ status: newsletterEditionsTable.status })
      .from(newsletterEditionsTable)
      .where(eq(newsletterEditionsTable.id, id));

    if (!existing) {
      res.status(404).json({ error: "Ausgabe nicht gefunden" });
      return;
    }
    if (existing.status === "approved") {
      res.status(409).json({ error: "Ausgabe ist bereits freigegeben" });
      return;
    }

    const [updated] = await db
      .update(newsletterEditionsTable)
      .set({ status: "approved" })
      .where(eq(newsletterEditionsTable.id, id))
      .returning();

    logger.info({ id }, "Newsletter-Ausgabe freigegeben");
    res.json(updated);
  },
);

/**
 * POST /operator/newsletter/:id/reject
 * Reject a draft edition (status → "rejected").
 */
router.post(
  "/operator/newsletter/:id/reject",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const [existing] = await db
      .select({ status: newsletterEditionsTable.status })
      .from(newsletterEditionsTable)
      .where(eq(newsletterEditionsTable.id, id));

    if (!existing) {
      res.status(404).json({ error: "Ausgabe nicht gefunden" });
      return;
    }

    const [updated] = await db
      .update(newsletterEditionsTable)
      .set({ status: "rejected" })
      .where(eq(newsletterEditionsTable.id, id))
      .returning();

    logger.info({ id }, "Newsletter-Ausgabe verworfen");
    res.json(updated);
  },
);

/**
 * POST /operator/newsletter/batch
 * Trigger the weekly batch job manually from the operator UI.
 * Accepts optional { offsetDays } body to start from a different date offset.
 */
router.post(
  "/operator/newsletter/batch",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const offsetDays = typeof req.body?.offsetDays === "number"
      ? req.body.offsetDays
      : 1;
    try {
      // Run async so the HTTP response is immediate
      runNewsWeeklyBatch(offsetDays)
        .then((r) => logger.info(r, "Newsletter-Batch manuell abgeschlossen"))
        .catch((err) => logger.error({ err }, "Newsletter-Batch manuell fehlgeschlagen"));
      res.json({ status: "started", message: "Batch-Generierung gestartet (läuft im Hintergrund)" });
    } catch (err) {
      logger.error({ err }, "Newsletter-Batch konnte nicht gestartet werden");
      res.status(500).json({ error: "Batch konnte nicht gestartet werden" });
    }
  },
);

/**
 * POST /operator/newsletter/batch/sync
 * Trigger weekly batch and wait for result (for testing — returns full result).
 */
router.post(
  "/operator/newsletter/batch/sync",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const offsetDays = typeof req.body?.offsetDays === "number"
      ? req.body.offsetDays
      : 0;
    try {
      const result = await runNewsWeeklyBatch(offsetDays);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Newsletter-Batch-Sync fehlgeschlagen");
      res.status(500).json({ error: String(err) });
    }
  },
);

/**
 * POST /operator/newsletter/swap-dates
 * Swap the scheduledDate of two editions (to reorder topic-to-day assignment).
 * Body: { idA: string, idB: string }
 */
router.post(
  "/operator/newsletter/swap-dates",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { idA, idB } = req.body as { idA?: string; idB?: string };
    if (!idA || !idB || idA === idB) {
      res.status(400).json({ error: "Zwei verschiedene Edition-IDs erforderlich" });
      return;
    }

    // Load both editions
    const [edA] = await db
      .select({ id: newsletterEditionsTable.id, scheduledDate: newsletterEditionsTable.scheduledDate })
      .from(newsletterEditionsTable)
      .where(eq(newsletterEditionsTable.id, idA));
    const [edB] = await db
      .select({ id: newsletterEditionsTable.id, scheduledDate: newsletterEditionsTable.scheduledDate })
      .from(newsletterEditionsTable)
      .where(eq(newsletterEditionsTable.id, idB));

    if (!edA || !edB) {
      res.status(404).json({ error: "Eine oder beide Ausgaben nicht gefunden" });
      return;
    }

    // Swap dates in a transaction using a temporary placeholder date to avoid unique-constraint conflicts
    const tempDate = "1970-01-01";
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(newsletterEditionsTable)
          .set({ scheduledDate: tempDate })
          .where(eq(newsletterEditionsTable.id, idA));
        await tx
          .update(newsletterEditionsTable)
          .set({ scheduledDate: edA.scheduledDate })
          .where(eq(newsletterEditionsTable.id, idB));
        await tx
          .update(newsletterEditionsTable)
          .set({ scheduledDate: edB.scheduledDate })
          .where(eq(newsletterEditionsTable.id, idA));
      });
    } catch (err) {
      logger.error({ err }, "Datum-Tausch fehlgeschlagen");
      res.status(500).json({ error: "Datum-Tausch fehlgeschlagen" });
      return;
    }

    res.json({ ok: true, swapped: [idA, idB] });
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// NEWS TOPICS — Operator CRUD
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/operator/news-topics",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const topics = await db
      .select()
      .from(newsTopicsTable)
      .orderBy(asc(newsTopicsTable.sortOrder));
    res.json(topics);
  },
);

router.put(
  "/operator/news-topics/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { name, color, sourceUrls, sortOrder, active } = req.body as {
      name?: string;
      color?: string;
      sourceUrls?: string[];
      sortOrder?: number;
      active?: boolean;
    };

    const [updated] = await db
      .update(newsTopicsTable)
      .set({
        ...(name ? { name } : {}),
        ...(color ? { color } : {}),
        ...(sourceUrls !== undefined ? { sourceUrls } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(active !== undefined ? { active } : {}),
      })
      .where(eq(newsTopicsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Thema nicht gefunden" });
      return;
    }
    res.json(updated);
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// CRON endpoint — external trigger (no auth, uses CRON_SECRET)
// ═══════════════════════════════════════════════════════════════════════════════

router.post(
  "/admin/cron/run-news-batch",
  async (req: Request, res: Response) => {
    if (!verifyCronSecret(req, res)) return;
    runNewsWeeklyBatch(1)
      .then((r) => logger.info(r, "Newsletter-Batch via Cron abgeschlossen"))
      .catch((err) => logger.error({ err }, "Newsletter-Batch Cron-Fehler"));
    res.json({ status: "started" });
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY news_editions routes (kept for backward-compat)
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/news/latest", requireAuth, async (_req: Request, res: Response) => {
  // First try the new newsletter system
  const today = todayStr();
  const [newsletter] = await db
    .select({
      id: newsletterEditionsTable.id,
      title: newsletterEditionsTable.title,
      teaser: sql<string>`LEFT(${newsletterEditionsTable.appBody}, 200)`,
      topicBadges: sql<string[]>`ARRAY[${newsletterEditionsTable.topic}]`,
      publishedAt: newsletterEditionsTable.batchRunAt,
    })
    .from(newsletterEditionsTable)
    .where(
      and(
        eq(newsletterEditionsTable.status, "approved"),
        lte(newsletterEditionsTable.scheduledDate, today),
      ),
    )
    .orderBy(desc(newsletterEditionsTable.scheduledDate))
    .limit(1);

  if (newsletter) {
    res.json(newsletter);
    return;
  }

  // Fall back to legacy table
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
  const today = todayStr();
  const [newsletter] = await db
    .select()
    .from(newsletterEditionsTable)
    .where(
      and(
        eq(newsletterEditionsTable.status, "approved"),
        lte(newsletterEditionsTable.scheduledDate, today),
      ),
    )
    .orderBy(desc(newsletterEditionsTable.scheduledDate))
    .limit(1);

  if (newsletter) {
    res.json({
      id: newsletter.id,
      title: newsletter.title,
      teaser: null,
      bodyMarkdown: newsletter.appBody,
      topicBadges: [newsletter.topic],
      publishedAt: newsletter.batchRunAt?.toISOString() ?? null,
    });
    return;
  }

  // Fall back
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

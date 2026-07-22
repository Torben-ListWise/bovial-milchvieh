import { Router, type IRouter, type Request, type Response } from "express";
import { sql, eq } from "drizzle-orm";
import {
  db,
  messagesTable,
  messageFeedbackTable,
  analysesTable,
  subscriptionsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { sendFrustrationAlert, fireEmail } from "../lib/emailService";
import { z } from "zod";

const router: IRouter = Router();

const FeedbackBody = z.object({
  rating: z.enum(["up", "down"]),
  comment: z.string().max(1000).optional().nullable(),
});

// ── POST /api/messages/:messageId/feedback ────────────────────────────────────
// Upsert feedback (thumbs up/down + optional comment) for a message.
// Only beta-plan users may submit feedback.
router.post(
  "/messages/:messageId/feedback",
  requireAuth,
  async (req: Request, res: Response) => {
    const messageId = req.params["messageId"] as string;
    const userId = req.userId!;

    try {
      // Verify message exists and belongs to the requesting user
      const [msg] = await db
        .select({ id: messagesTable.id, analysisId: messagesTable.analysisId })
        .from(messagesTable)
        .where(sql`${messagesTable.id} = ${messageId}`)
        .limit(1);

      if (!msg) {
        res.status(404).json({ error: "Nachricht nicht gefunden" });
        return;
      }

      // Verify analysis belongs to user
      const [analysis] = await db
        .select({ userId: analysesTable.userId })
        .from(analysesTable)
        .where(eq(analysesTable.id, msg.analysisId))
        .limit(1);

      if (!analysis || analysis.userId !== userId) {
        res.status(403).json({ error: "Kein Zugriff auf diese Nachricht" });
        return;
      }

      // Verify user is on beta plan
      const [sub] = await db
        .select({ plan: subscriptionsTable.plan })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, userId))
        .limit(1);

      if (sub?.plan !== "beta") {
        res.status(403).json({ error: "Feedback ist nur für Beta-Nutzer verfügbar" });
        return;
      }

      const parsed = FeedbackBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Ungültige Eingabe" });
        return;
      }

      const { rating, comment } = parsed.data;

      await db.execute(sql`
        INSERT INTO message_feedback (id, message_id, user_id, rating, comment, created_at, updated_at)
        VALUES (gen_random_uuid(), ${messageId}, ${userId}, ${rating}, ${comment ?? null}, NOW(), NOW())
        ON CONFLICT (message_id, user_id)
        DO UPDATE SET rating = ${rating}, comment = ${comment ?? null}, updated_at = NOW()
      `);

      res.json({ ok: true, messageId, rating });

      // Frustrations-Erkennung (fire-and-forget): Wenn ≥ 2 Daumen-runter
      // innerhalb von 7 Tagen für diesen Nutzer → Betreiber-Alert per E-Mail.
      if (rating === "down") {
        (async () => {
          try {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const rows = await db.execute(sql`
              SELECT COUNT(*)::int AS down_count
              FROM message_feedback
              WHERE user_id = ${userId}
                AND rating = 'down'
                AND updated_at >= ${sevenDaysAgo}
            `);
            const downCount = Number((rows.rows[0] as any)?.down_count ?? 0);
            if (downCount >= 2) {
              const operatorEmail = process.env["OPERATOR_EMAIL"];
              if (operatorEmail) {
                fireEmail(
                  sendFrustrationAlert(operatorEmail, userId, downCount),
                  `frustration:${userId}`,
                );
              }
            }
          } catch (alertErr) {
            logger.warn({ alertErr, userId }, "Frustrations-Alert fehlgeschlagen");
          }
        })().catch(() => {});
      }
    } catch (err) {
      logger.error({ err, messageId, userId }, "POST /messages/:id/feedback fehlgeschlagen");
      res.status(500).json({ error: "Interner Fehler" });
    }
  },
);

// ── GET /api/messages/:messageId/feedback ─────────────────────────────────────
// Returns current user's feedback for a message (null if none).
router.get(
  "/messages/:messageId/feedback",
  requireAuth,
  async (req: Request, res: Response) => {
    const messageId = req.params["messageId"] as string;
    const userId = req.userId!;

    try {
      const [fb] = await db
        .select()
        .from(messageFeedbackTable)
        .where(
          sql`${messageFeedbackTable.messageId} = ${messageId}
              AND ${messageFeedbackTable.userId} = ${userId}`
        )
        .limit(1);

      res.json(fb ?? null);
    } catch (err) {
      logger.error({ err }, "GET /messages/:id/feedback fehlgeschlagen");
      res.status(500).json({ error: "Interner Fehler" });
    }
  },
);

export default router;

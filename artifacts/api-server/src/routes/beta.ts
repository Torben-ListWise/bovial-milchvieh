import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  analysesTable,
  messagesTable,
  betaToolLogsTable,
  messageFeedbackTable,
  subscriptionsTable,
} from "@workspace/db";
import { requireAuth, requireOperator } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── GET /api/admin/beta/transcripts ───────────────────────────────────────────
// Lists analyses from beta-plan users with summary info (escalation, feedback).
// Query params: userId (filter by user), escalated (true/false), thumbsDown (true/false)
router.get(
  "/admin/beta/transcripts",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    try {
      const { userId: filterUserId, escalated, thumbsDown } = req.query as Record<string, string | undefined>;

      const rows = await db.execute(sql`
        SELECT
          a.id              AS analysis_id,
          a.title,
          a.created_at      AS analysis_created_at,
          u.id              AS user_id,
          u.email           AS user_email,
          u.name            AS user_name,
          COUNT(DISTINCT m.id) FILTER (WHERE m.role = 'user')      AS question_count,
          COUNT(DISTINCT m.id) FILTER (WHERE m.role = 'assistant') AS answer_count,
          BOOL_OR(btl.escalation_trigger IS NOT NULL)               AS has_escalation,
          MAX(btl.escalation_trigger)                               AS last_escalation_type,
          COUNT(DISTINCT mf.id) FILTER (WHERE mf.rating = 'down')  AS thumbs_down_count,
          COUNT(DISTINCT mf.id) FILTER (WHERE mf.rating = 'up')    AS thumbs_up_count,
          MAX(a.updated_at) AS last_activity
        FROM analyses a
        JOIN users u ON u.id = a.user_id
        JOIN subscriptions s ON s.user_id = u.id AND s.plan = 'beta'
        LEFT JOIN messages m ON m.analysis_id = a.id AND m.hidden = false
        LEFT JOIN beta_tool_logs btl ON btl.analysis_id = a.id
        LEFT JOIN message_feedback mf ON mf.message_id = m.id
        ${filterUserId ? sql`WHERE u.id = ${filterUserId}` : sql``}
        GROUP BY a.id, u.id
        ${escalated === "true" ? sql`HAVING BOOL_OR(btl.escalation_trigger IS NOT NULL) = true` : sql``}
        ORDER BY MAX(a.updated_at) DESC
        LIMIT 200
      `);

      const list = ((rows as any).rows ?? rows) as Array<Record<string, unknown>>;

      const filtered = thumbsDown === "true"
        ? list.filter((r) => Number(r.thumbs_down_count) > 0)
        : list;

      res.json(filtered);
    } catch (err) {
      logger.error({ err }, "GET /admin/beta/transcripts fehlgeschlagen");
      res.status(500).json({ error: "Interner Fehler" });
    }
  },
);

// ── GET /api/admin/beta/transcripts/:analysisId ───────────────────────────────
// Returns full transcript with tool logs and feedback for a single analysis.
router.get(
  "/admin/beta/transcripts/:analysisId",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const analysisId = req.params["analysisId"] as string;
    try {
      // Verify the analysis belongs to a beta user
      const [analysis] = await db.execute(sql`
        SELECT a.*, u.email AS user_email, u.name AS user_name
        FROM analyses a
        JOIN users u ON u.id = a.user_id
        JOIN subscriptions s ON s.user_id = u.id AND s.plan = 'beta'
        WHERE a.id = ${analysisId}
        LIMIT 1
      `).then((r) => ((r as any).rows ?? r) as Array<Record<string, unknown>>);

      if (!analysis) {
        res.status(404).json({ error: "Analyse nicht gefunden oder kein Beta-Nutzer" });
        return;
      }

      const messages = await db
        .select()
        .from(messagesTable)
        .where(sql`${messagesTable.analysisId} = ${analysisId}`)
        .orderBy(messagesTable.createdAt);

      const toolLogs = await db
        .select()
        .from(betaToolLogsTable)
        .where(sql`${betaToolLogsTable.analysisId} = ${analysisId}`)
        .orderBy(betaToolLogsTable.createdAt);

      const feedback = await db
        .select({
          id: messageFeedbackTable.id,
          messageId: messageFeedbackTable.messageId,
          userId: messageFeedbackTable.userId,
          rating: messageFeedbackTable.rating,
          comment: messageFeedbackTable.comment,
          createdAt: messageFeedbackTable.createdAt,
        })
        .from(messageFeedbackTable)
        .where(
          sql`${messageFeedbackTable.messageId} IN (
            SELECT id FROM messages WHERE analysis_id = ${analysisId}
          )`
        );

      // Build a map for quick lookup
      const toolLogsByMessage = new Map<string, typeof toolLogs>();
      for (const log of toolLogs) {
        if (!log.messageId) continue;
        const key = log.messageId;
        if (!toolLogsByMessage.has(key)) toolLogsByMessage.set(key, []);
        toolLogsByMessage.get(key)!.push(log);
      }

      const feedbackByMessage = new Map<string, typeof feedback[0]>();
      for (const fb of feedback) {
        feedbackByMessage.set(fb.messageId, fb);
      }

      const enrichedMessages = messages
        .filter((m) => !m.hidden)
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content ?? null,
          citations: (m.citations as unknown[]) ?? [],
          charts: (m.charts as unknown[]) ?? [],
          createdAt: m.createdAt,
          toolLogs: toolLogsByMessage.get(m.id) ?? [],
          feedback: feedbackByMessage.get(m.id) ?? null,
        }));

      res.json({
        analysisId: analysis.id,
        title: analysis.title,
        userEmail: analysis.user_email,
        userName: analysis.user_name,
        userId: analysis.user_id,
        createdAt: analysis.created_at,
        messages: enrichedMessages,
      });
    } catch (err) {
      logger.error({ err, analysisId }, "GET /admin/beta/transcripts/:id fehlgeschlagen");
      res.status(500).json({ error: "Interner Fehler" });
    }
  },
);

export default router;

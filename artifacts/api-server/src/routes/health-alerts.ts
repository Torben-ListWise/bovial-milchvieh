/**
 * Routen für amtliche Tierseuchen-/Gesundheitswarnungen.
 *
 * Operator-Routes (requireOperator):
 *   GET  /api/health-alerts/operator           — alle Meldungen (pending/approved/rejected)
 *   POST /api/health-alerts/operator/:id/approve — Meldung bestätigen
 *   POST /api/health-alerts/operator/:id/reject  — Meldung ablehnen
 *
 * Kunden-Route (requireAuth):
 *   GET  /api/health-alerts                    — nur bestätigte Meldungen (neueste pro topic)
 */

import { Router, type Request, type Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, animalHealthAlertsTable } from "@workspace/db";
import { requireAuth, requireOperator } from "../lib/auth";

const router = Router();

// ── Operator: alle Meldungen auflisten ────────────────────────────────────────

router.get(
  "/health-alerts/operator",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const status = (req.query["status"] as string | undefined) ?? "pending";

    const rows = await db
      .select()
      .from(animalHealthAlertsTable)
      .where(
        status === "all"
          ? undefined
          : eq(animalHealthAlertsTable.status, status),
      )
      .orderBy(desc(animalHealthAlertsTable.createdAt))
      .limit(200);

    res.json(rows);
  },
);

// ── Operator: Meldung bestätigen ──────────────────────────────────────────────

router.post(
  "/health-alerts/operator/:id/approve",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).userId as string;

    await db
      .update(animalHealthAlertsTable)
      .set({
        status: "approved",
        reviewedBy: userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(animalHealthAlertsTable.id, id));

    res.json({ ok: true });
  },
);

// ── Operator: Meldung ablehnen ────────────────────────────────────────────────

router.post(
  "/health-alerts/operator/:id/reject",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).userId as string;

    await db
      .update(animalHealthAlertsTable)
      .set({
        status: "rejected",
        reviewedBy: userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(animalHealthAlertsTable.id, id));

    res.json({ ok: true });
  },
);

// ── Kunden: aktuelle bestätigte Meldungen (neueste pro topic) ─────────────────

router.get(
  "/health-alerts",
  requireAuth,
  async (_req: Request, res: Response) => {
    const allApproved = await db
      .select()
      .from(animalHealthAlertsTable)
      .where(eq(animalHealthAlertsTable.status, "approved"))
      .orderBy(desc(animalHealthAlertsTable.updatedAt));

    // Deduplizierung: neueste pro topic
    const byTopic = new Map<string, typeof allApproved[0]>();
    for (const row of allApproved) {
      if (!byTopic.has(row.topic)) {
        byTopic.set(row.topic, row);
      }
    }

    const result = Array.from(byTopic.values()).sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    res.json(result);
  },
);

export default router;

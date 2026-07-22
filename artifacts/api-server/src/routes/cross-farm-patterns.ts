/**
 * Routen für betriebsübergreifende Erfolgsmuster-Empfehlungen.
 *
 * Operator-Routen (requireOperator):
 *   GET   /api/admin/cross-farm-patterns              — alle Kandidaten (filtern nach status)
 *   PATCH /api/admin/cross-farm-patterns/:id          — Musteraussage + Notizen editieren
 *   POST  /api/admin/cross-farm-patterns/:id/approve  — freigeben (status → approved)
 *   POST  /api/admin/cross-farm-patterns/:id/reject   — ablehnen (status → rejected)
 *   POST  /api/admin/cron/run-pattern-extraction      — manueller Batch-Trigger
 *
 * Kunden-Routen (requireAuth, nur opted-in Nutzer):
 *   GET   /api/cross-farm-patterns                    — nur freigegebene Muster
 *
 * DSGVO-Hinweis: Nutzerdaten werden nur von Betrieben mit
 *   pattern_sharing_opted_in = TRUE verarbeitet.
 */

import { Router, type Request, type Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { db, crossFarmPatternsTable } from "@workspace/db";
import { requireAuth, requireOperator } from "../lib/auth";
import { runPatternExtraction } from "../lib/crossFarmPatternExtractor";

const router = Router();

// ── Operator: alle Muster-Kandidaten listen ───────────────────────────────────

router.get(
  "/admin/cross-farm-patterns",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const status = (req.query["status"] as string | undefined) ?? "pending";

    const rows = await db
      .select()
      .from(crossFarmPatternsTable)
      .where(
        status === "all"
          ? undefined
          : eq(crossFarmPatternsTable.status, status),
      )
      .orderBy(desc(crossFarmPatternsTable.createdAt))
      .limit(200);

    res.json(rows);
  },
);

// ── Operator: Musteraussage und Notizen editieren ─────────────────────────────

const PatchBodySchema = z.object({
  patternStatement: z.string().max(2000).optional(),
  patternKey: z.string().max(100).optional(),
  reviewNotes: z.string().max(1000).optional(),
  relevanceTags: z.array(z.string().max(50)).max(10).optional(),
});

router.patch(
  "/admin/cross-farm-patterns/:id",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const parsed = PatchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ungültige Eingabe" });
      return;
    }

    const fields: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.patternStatement !== undefined)
      fields.patternStatement = parsed.data.patternStatement;
    if (parsed.data.patternKey !== undefined)
      fields.patternKey = parsed.data.patternKey;
    if (parsed.data.reviewNotes !== undefined)
      fields.reviewNotes = parsed.data.reviewNotes;
    if (parsed.data.relevanceTags !== undefined)
      fields.relevanceTags = parsed.data.relevanceTags;

    const [updated] = await db
      .update(crossFarmPatternsTable)
      .set(fields as any)
      .where(eq(crossFarmPatternsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Muster nicht gefunden" });
      return;
    }

    res.json(updated);
  },
);

// ── Operator: Muster freigeben ────────────────────────────────────────────────

router.post(
  "/admin/cross-farm-patterns/:id/approve",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;

    const [existing] = await db
      .select({ patternStatement: crossFarmPatternsTable.patternStatement })
      .from(crossFarmPatternsTable)
      .where(eq(crossFarmPatternsTable.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Muster nicht gefunden" });
      return;
    }

    if (!existing.patternStatement?.trim()) {
      res.status(400).json({
        error: "Musteraussage (patternStatement) muss vor der Freigabe ausgefüllt sein.",
      });
      return;
    }

    await db
      .update(crossFarmPatternsTable)
      .set({
        status: "approved",
        reviewedBy: userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(eq(crossFarmPatternsTable.id, id));

    res.json({ ok: true });
  },
);

// ── Operator: Muster ablehnen ─────────────────────────────────────────────────

router.post(
  "/admin/cross-farm-patterns/:id/reject",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;

    await db
      .update(crossFarmPatternsTable)
      .set({
        status: "rejected",
        reviewedBy: userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(eq(crossFarmPatternsTable.id, id));

    res.json({ ok: true });
  },
);

// ── Operator: Manueller Batch-Trigger ─────────────────────────────────────────

router.post(
  "/admin/cron/run-pattern-extraction",
  requireAuth,
  requireOperator,
  async (_req: Request, res: Response) => {
    const cronSecret = process.env["CRON_SECRET"];
    if (!cronSecret) {
      res.status(503).json({ error: "CRON_SECRET nicht konfiguriert" });
      return;
    }

    res.json({ ok: true, message: "Pattern extraction gestartet" });

    setImmediate(async () => {
      try {
        const result = await runPatternExtraction();
        console.info("[cross-farm-patterns] Manual extraction:", result);
      } catch (err) {
        console.error("[cross-farm-patterns] Manual extraction failed:", err);
      }
    });
  },
);

// ── Kunden: freigegebene Muster abrufen (nur opted-in) ────────────────────────

router.get(
  "/cross-farm-patterns",
  requireAuth,
  async (req: Request, res: Response) => {
    const user = req.appUser as any;

    if (!user?.patternSharingOptedIn) {
      res.status(403).json({
        error: "Funktion nicht aktiviert",
        hint: "Aktiviere die betriebsübergreifenden Empfehlungen in den Einstellungen.",
      });
      return;
    }

    const rows = await db
      .select({
        id: crossFarmPatternsTable.id,
        kpiName: crossFarmPatternsTable.kpiName,
        changeDescription: crossFarmPatternsTable.changeDescription,
        avgImprovement: crossFarmPatternsTable.avgImprovement,
        sampleSize: crossFarmPatternsTable.sampleSize,
        observationPeriodMonths: crossFarmPatternsTable.observationPeriodMonths,
        patternStatement: crossFarmPatternsTable.patternStatement,
        patternKey: crossFarmPatternsTable.patternKey,
        relevanceTags: crossFarmPatternsTable.relevanceTags,
        createdAt: crossFarmPatternsTable.createdAt,
      })
      .from(crossFarmPatternsTable)
      .where(eq(crossFarmPatternsTable.status, "approved"))
      .orderBy(desc(crossFarmPatternsTable.reviewedAt))
      .limit(20);

    res.json(rows);
  },
);

export default router;

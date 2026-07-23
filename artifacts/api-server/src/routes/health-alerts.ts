/**
 * Routen für amtliche Tierseuchen-/Gesundheitswarnungen.
 *
 * Operator-Routes (requireOperator):
 *   GET  /api/health-alerts/operator           — alle Meldungen (pending/approved/rejected)
 *   POST /api/health-alerts/operator/:id/approve — Meldung bestätigen
 *   POST /api/health-alerts/operator/:id/reject  — Meldung ablehnen
 *
 * Kunden-Routen (requireAuth):
 *   GET  /api/health-alerts         — bestätigte Meldungen gefiltert nach Tierart + Aktualität (90 Tage)
 *   GET  /api/disease-catalog       — voller Seuchen-Katalog (für Popovers)
 */

import { Router, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, animalHealthAlertsTable, diseaseCatalogTable, usersTable } from "@workspace/db";
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
    const id = req.params["id"] as string;
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
    const id = req.params["id"] as string;
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

// ── Kunden: aktuelle bestätigte Meldungen (species-gefiltert + Aktualitäts-Gate) ─────────

const FRESHNESS_DAYS = 90;

router.get(
  "/health-alerts",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;

    // Focus Areas des Nutzers laden
    const [userRow] = await db
      .select({ focusAreas: usersTable.focusAreas })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const focusAreas: string[] | null = userRow?.focusAreas ?? null;

    // Alle bestätigten Meldungen (neueste zuerst)
    const allApproved = await db
      .select()
      .from(animalHealthAlertsTable)
      .where(eq(animalHealthAlertsTable.status, "approved"))
      .orderBy(desc(animalHealthAlertsTable.updatedAt));

    const cutoff = new Date(Date.now() - FRESHNESS_DAYS * 24 * 60 * 60 * 1000);

    // Deduplizierung: neueste pro topic
    const byTopic = new Map<string, typeof allApproved[0]>();
    for (const row of allApproved) {
      if (!byTopic.has(row.topic)) {
        byTopic.set(row.topic, row);
      }
    }

    const result = Array.from(byTopic.values())
      // ── Aktualitäts-Gate: mind. officialDate oder updatedAt innerhalb 90 Tage ──
      .filter((row) => {
        const officialTs = row.officialDate ? new Date(row.officialDate) : null;
        const updatedTs = row.updatedAt ? new Date(row.updatedAt) : null;
        const newest = officialTs && updatedTs
          ? new Date(Math.max(officialTs.getTime(), updatedTs.getTime()))
          : officialTs ?? updatedTs;
        return newest ? newest >= cutoff : false;
      })
      // ── Tierart-Filter ───────────────────────────────────────────────────────
      .filter((row) => {
        // Keine Focus Areas → alle anzeigen
        if (!focusAreas || focusAreas.length === 0) return true;
        // mischbetrieb / sonstiges → alle anzeigen
        if (focusAreas.includes("mischbetrieb") || focusAreas.includes("sonstiges")) return true;

        const species: string[] = (row as any).affectedSpecies ?? ["allgemein"];
        // allgemein-Meldungen immer anzeigen
        if (species.includes("allgemein")) return true;
        // Überschneidung mit den Focus Areas des Nutzers
        return species.some((s) => focusAreas.includes(s));
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

    res.json(result);
  },
);

// ── Disease Catalog: voller Katalog für Popovers ──────────────────────────────

router.get(
  "/disease-catalog",
  requireAuth,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(diseaseCatalogTable)
      .orderBy(diseaseCatalogTable.topicKey);

    res.json(rows);
  },
);

export default router;

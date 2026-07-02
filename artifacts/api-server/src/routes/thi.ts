import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { db, usersTable, thiForecasts } from "@workspace/db";
import { computeThiForUser, upsertForecastPublic } from "../lib/thi";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// How old a cached forecast may be before we re-fetch on demand (2 hours)
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

// ── GET /api/thi/current ─────────────────────────────────────────────────────
// Returns current THI data for the logged-in user.
// If no cached data or cache stale: fetches Open-Meteo on demand.
router.get("/thi/current", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;

  const user = await db
    .select({
      lat: (usersTable as any).lat,
      lng: (usersTable as any).lng,
      stallCoolingCorrection: (usersTable as any).stallCoolingCorrection,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const u = user[0];
  if (!u || u.lat == null || u.lng == null) {
    res.json({ configured: false });
    return;
  }

  // Check cache
  const cached = await db
    .select()
    .from(thiForecasts)
    .where(eq(thiForecasts.userId, userId))
    .limit(1);

  const row = cached[0];
  const isStale =
    !row ||
    Date.now() - new Date(row.fetchedAt).getTime() > CACHE_TTL_MS;

  if (!isStale && row) {
    res.json({
      configured: true,
      outdoorThiCurrent: row.outdoorThiCurrent,
      effectiveThiCurrent: row.effectiveThiCurrent,
      status: row.status,
      nextDayMaxThi: row.nextDayMaxThi,
      heatStressHours: row.heatStressHours,
      fetchedAt: row.fetchedAt,
      correction: u.stallCoolingCorrection ?? 0,
    });
    return;
  }

  // Fresh fetch
  try {
    const correction = (u.stallCoolingCorrection as number) ?? 0;
    const result = await computeThiForUser(u.lat as number, u.lng as number, correction);
    await upsertForecastPublic(userId, result);
    res.json({
      configured: true,
      outdoorThiCurrent: result.outdoorThiCurrent,
      effectiveThiCurrent: result.effectiveThiCurrent,
      status: result.status,
      nextDayMaxThi: result.nextDayMaxThi,
      heatStressHours: result.heatStressHours,
      fetchedAt: new Date(),
      correction,
    });
  } catch (err) {
    logger.error({ err, userId }, "THI: Open-Meteo-Abruf fehlgeschlagen");
    res.status(502).json({ error: "Wetterdaten konnten nicht abgerufen werden." });
  }
});

// ── GET /api/thi/settings ────────────────────────────────────────────────────
router.get("/thi/settings", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const user = await db
    .select({
      lat: (usersTable as any).lat,
      lng: (usersTable as any).lng,
      stallCoolingCorrection: (usersTable as any).stallCoolingCorrection,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const u = user[0];
  res.json({
    lat: u?.lat ?? null,
    lng: u?.lng ?? null,
    stallCoolingCorrection: u?.stallCoolingCorrection ?? 0,
  });
});

// ── PATCH /api/thi/settings ──────────────────────────────────────────────────
const ThiSettingsSchema = z.object({
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  stallCoolingCorrection: z.number().int().min(-15).max(0).optional(),
});

router.patch("/thi/settings", requireAuth, async (req: Request, res: Response) => {
  const parsed = ThiSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe", details: parsed.error.issues });
    return;
  }

  const { lat, lng, stallCoolingCorrection } = parsed.data;
  const updateFields: Record<string, unknown> = {};
  if (lat !== undefined) updateFields.lat = lat;
  if (lng !== undefined) updateFields.lng = lng;
  if (stallCoolingCorrection !== undefined) updateFields.stallCoolingCorrection = stallCoolingCorrection;

  await db
    .update(usersTable)
    .set(updateFields as any)
    .where(eq(usersTable.id, req.userId!));

  // Invalidate cached THI so next fetch is fresh
  if (lat !== undefined || lng !== undefined || stallCoolingCorrection !== undefined) {
    await db.delete(thiForecasts).where(eq(thiForecasts.userId, req.userId!));
  }

  res.json({ ok: true });
});

export default router;

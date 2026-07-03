/**
 * GET /api/chips/daily
 * Returns today's 3 chip suggestions (from daily_chip_suggestions where valid_date = today).
 * Falls back to 3 hardcoded default chips if the table has no entries for today.
 */

import { Router, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db, dailyChipSuggestionsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router = Router();

const DEFAULT_CHIPS = [
  { chipText: "Zellzahl-Trend analysieren", category: "Zellzahl", rank: 1 },
  { chipText: "Pregnancy Rate prüfen", category: "Fruchtbarkeit", rank: 2 },
  { chipText: "Remontierungsrate prüfen", category: "Remontierungsrate", rank: 3 },
];

router.get("/chips/daily", requireAuth, async (_req: Request, res: Response) => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);

    const chips = await db
      .select({
        chipText: dailyChipSuggestionsTable.chipText,
        category: dailyChipSuggestionsTable.category,
        rank: dailyChipSuggestionsTable.rank,
      })
      .from(dailyChipSuggestionsTable)
      .where(eq(dailyChipSuggestionsTable.validDate, todayStr))
      .orderBy(dailyChipSuggestionsTable.rank)
      .limit(3);

    res.json({ chips: chips.length > 0 ? chips : DEFAULT_CHIPS });
  } catch (err) {
    res.json({ chips: DEFAULT_CHIPS });
  }
});

export default router;

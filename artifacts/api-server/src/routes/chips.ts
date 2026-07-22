/**
 * GET /api/chips/daily
 * Returns today's 3 chip suggestions (from daily_chip_suggestions where valid_date = today).
 * Falls back to 3 hardcoded default chips if the table has no entries for today.
 *
 * Per-user calc-chip injection (Punkt 4):
 * Established users (first question > 14 days ago) who have never asked a
 * calculator-related question get a calc-discovery chip injected into slot 3,
 * replacing the lowest-rank suggestion — so they discover the feature organically.
 */

import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, dailyChipSuggestionsTable, questionLogTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router = Router();

const DEFAULT_CHIPS = [
  { chipText: "Zellzahl-Trend analysieren", category: "Zellzahl", rank: 1, actionHref: null },
  { chipText: "Pregnancy Rate prüfen", category: "Fruchtbarkeit", rank: 2, actionHref: null },
  { chipText: "Remontierungsrate prüfen", category: "Remontierungsrate", rank: 3, actionHref: null },
];

const CALC_DISCOVERY_CHIPS = [
  { chipText: "Was kostet meine Besamungsstrategie?", category: "__calc_semen", rank: 3, actionHref: "/app/semen-planning" },
  { chipText: "Besamungskosten optimieren", category: "__calc_semen", rank: 3, actionHref: "/app/semen-planning" },
  { chipText: "Spermakosten kalkulieren", category: "__calc_semen", rank: 3, actionHref: "/app/semen-planning" },
];

/** Keywords that indicate a user has already engaged with calculators. */
const CALC_KEYWORDS_PATTERN = "(semen|besamung|kalkulator|rechner|spermakosten|spermapreis|besamungskosten)";

router.get("/chips/daily", requireAuth, async (req: Request, res: Response) => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);

    let chips = await db
      .select({
        chipText: dailyChipSuggestionsTable.chipText,
        category: dailyChipSuggestionsTable.category,
        rank: dailyChipSuggestionsTable.rank,
        actionHref: dailyChipSuggestionsTable.actionHref,
      })
      .from(dailyChipSuggestionsTable)
      .where(eq(dailyChipSuggestionsTable.validDate, todayStr))
      .orderBy(dailyChipSuggestionsTable.rank)
      .limit(3);

    if (chips.length === 0) chips = DEFAULT_CHIPS;

    // Per-user calc discovery: inject a calc chip for established users who
    // have never engaged with calculator-related questions.
    const userId = req.userId;
    if (userId) {
      try {
        // Only inject if the daily chips don't already include a calc chip.
        const alreadyHasCalcChip = chips.some((c) => c.category?.startsWith("__calc"));
        if (!alreadyHasCalcChip) {
          const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

          // Check user's oldest logged question to determine account age.
          const [{ firstAt }] = await db
            .select({ firstAt: sql<Date | null>`MIN(${questionLogTable.createdAt})` })
            .from(questionLogTable)
            .where(eq(questionLogTable.userId, userId)) as [{ firstAt: Date | null }];

          const isEstablished = firstAt != null && new Date(firstAt) < fourteenDaysAgo;

          if (isEstablished) {
            // Check whether the user ever asked a calc-related question.
            const [{ calcCount }] = await db
              .select({ calcCount: sql<number>`COUNT(*)::int` })
              .from(questionLogTable)
              .where(
                and(
                  eq(questionLogTable.userId, userId),
                  sql`LOWER(${questionLogTable.questionText}) ~ ${CALC_KEYWORDS_PATTERN}`,
                ),
              ) as [{ calcCount: number }];

            if (Number(calcCount) === 0) {
              // Pick a calc chip variant based on day-of-year for variety.
              const dayOfYear = Math.floor(
                (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000,
              );
              const discoveryChip = CALC_DISCOVERY_CHIPS[dayOfYear % CALC_DISCOVERY_CHIPS.length];
              // Replace the last chip (rank 3) with the calc discovery chip.
              chips = [...chips.slice(0, 2), discoveryChip];
            }
          }
        }
      } catch {
        // Per-user injection is best-effort — never block the main response.
      }
    }

    res.json({ chips });
  } catch (err) {
    res.json({ chips: DEFAULT_CHIPS });
  }
});

export default router;

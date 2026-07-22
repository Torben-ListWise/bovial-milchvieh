/**
 * Weekly knowledge-gaps report.
 *
 * Aggregates queries from the last 7 days where search_knowledge returned
 * noRelevantResults (stored in knowledge_missed_queries) and sends an
 * operator summary email so knowledge-base gaps can be addressed.
 *
 * External cron: POST /api/admin/cron/run-knowledge-gaps (X-Cron-Secret header).
 */

import { and, gte, sql } from "drizzle-orm";
import { db, knowledgeMissedQueriesTable } from "@workspace/db";
import { sendKnowledgeGapsReport, fireEmail } from "./emailService";
import { logger } from "./logger";

/**
 * Aggregate missed queries from the last N days, group by normalised query,
 * sort by frequency desc, return top results.
 */
async function aggregateMissedQueries(
  days: number,
  topN: number,
): Promise<Array<{ query: string; count: number; topScore: number | null }>> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await db
    .select({
      query: knowledgeMissedQueriesTable.query,
      count: sql<number>`COUNT(*)::int`,
      topScore: sql<number | null>`MAX(${knowledgeMissedQueriesTable.topScore})`,
    })
    .from(knowledgeMissedQueriesTable)
    .where(gte(knowledgeMissedQueriesTable.createdAt, since))
    .groupBy(knowledgeMissedQueriesTable.query)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(topN);

  return rows as Array<{ query: string; count: number; topScore: number | null }>;
}

/**
 * Core logic — can be triggered by external cron or in-process scheduler.
 */
export async function runKnowledgeGapsReport(days = 7, topN = 25): Promise<{
  queriesAnalysed: number;
  uniqueGaps: number;
  emailSent: boolean;
}> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [{ total }] = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(knowledgeMissedQueriesTable)
      .where(gte(knowledgeMissedQueriesTable.createdAt, since)) as [{ total: number }];

    if (total === 0) {
      logger.info("Wissenslücken-Bericht: Keine verpassten Suchanfragen in den letzten %d Tagen.", days);
      return { queriesAnalysed: 0, uniqueGaps: 0, emailSent: false };
    }

    const gaps = await aggregateMissedQueries(days, topN);

    const operatorEmail = process.env.OPERATOR_EMAIL;
    if (!operatorEmail) {
      logger.warn("Wissenslücken-Bericht: OPERATOR_EMAIL nicht konfiguriert — E-Mail nicht gesendet.");
      logger.info({ gaps }, "Wissenslücken-Bericht (kein E-Mail-Versand)");
      return { queriesAnalysed: total, uniqueGaps: gaps.length, emailSent: false };
    }

    fireEmail(
      sendKnowledgeGapsReport(operatorEmail, { days, totalMissed: total, gaps }),
      `knowledge-gaps-report:${new Date().toISOString().slice(0, 10)}`,
    );

    logger.info(
      { total, uniqueGaps: gaps.length, operatorEmail },
      "Wissenslücken-Bericht versendet",
    );

    return { queriesAnalysed: total, uniqueGaps: gaps.length, emailSent: true };
  } catch (err) {
    logger.error({ err }, "Wissenslücken-Bericht Fehler");
    return { queriesAnalysed: 0, uniqueGaps: 0, emailSent: false };
  }
}

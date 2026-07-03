/**
 * Daily chip scheduler.
 *
 * Runs nightly (02:00 server time).
 * 1. Reads all questions logged yesterday from question_log.
 * 2. Categorises each question into a direction-neutral topic via Haiku.
 * 3. Counts category frequency; ties broken by most-recent question in that category.
 * 4. Picks top-3 categories, generates a short chip text for each.
 * 5. Writes results to daily_chip_suggestions with valid_date = today + 1.
 *
 * External cron: POST /api/admin/cron/run-chips (X-Cron-Secret header).
 */

import Anthropic from "@anthropic-ai/sdk";
import { and, gte, lt, desc, sql } from "drizzle-orm";
import { db, questionLogTable, dailyChipSuggestionsTable } from "@workspace/db";
import { logger } from "./logger";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY nicht konfiguriert");
  return new Anthropic({ apiKey });
}

const HAIKU_MODEL = "claude-haiku-4-5";

interface CategoryResult {
  category: string;
  count: number;
  latestAt: Date;
}

/**
 * Step 1+2: Fetch yesterday's questions and categorise them via LLM.
 * Returns [{ question, category }].
 */
async function categoriseQuestions(
  questions: { text: string; createdAt: Date }[],
): Promise<Array<{ text: string; category: string; createdAt: Date }>> {
  if (questions.length === 0) return [];

  const client = getClient();

  const numbered = questions
    .map((q, i) => `${i + 1}. ${q.text}`)
    .join("\n");

  const systemPrompt = `Du bist ein Klassifikationssystem für Fragen von Milchviehbauern.
Für jede Frage bestimmst du ein kurzes, richtungsneutrales Kernthema (1-3 Wörter auf Deutsch).
Beispiele:
- "Warum ist meine Remontierungsrate so hoch?" → "Remontierungsrate"
- "Warum ist meine Remontierungsrate so niedrig?" → "Remontierungsrate"
- "Wie verbessere ich meine Konzeptionsrate?" → "Konzeptionsrate"
- "Was ist der Trend bei meiner Milchleistung?" → "Milchleistung"
- "Warum steigt mein Zellzahlwert?" → "Zellzahl"

Antworte NUR mit einer JSON-Liste im Format:
[{"i":1,"cat":"Thema"},{"i":2,"cat":"Thema"},...]
Keine weiteren Erklärungen.`;

  const userPrompt = `Klassifiziere diese Fragen:\n${numbered}`;

  let raw: string;
  try {
    const msg = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    });
    raw = (msg.content[0] as any)?.text ?? "[]";
  } catch (err) {
    logger.warn({ err }, "Chip-Kategorisierung LLM-Fehler");
    return questions.map((q) => ({ ...q, category: "Allgemein" }));
  }

  let parsed: Array<{ i: number; cat: string }> = [];
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    logger.warn({ raw }, "Chip-Kategorisierung: JSON-Parse-Fehler");
  }

  return questions.map((q, idx) => {
    const entry = parsed.find((p) => p.i === idx + 1);
    return { ...q, category: entry?.cat ?? "Allgemein" };
  });
}

/**
 * Step 3: Count categories. Tie-breaker: most recent question wins.
 */
function rankCategories(
  categorised: Array<{ category: string; createdAt: Date }>,
): CategoryResult[] {
  const map = new Map<string, { count: number; latestAt: Date }>();
  for (const { category, createdAt } of categorised) {
    const existing = map.get(category);
    if (!existing) {
      map.set(category, { count: 1, latestAt: createdAt });
    } else {
      existing.count += 1;
      if (createdAt > existing.latestAt) existing.latestAt = createdAt;
    }
  }
  return Array.from(map.entries())
    .map(([category, { count, latestAt }]) => ({ category, count, latestAt }))
    .sort((a, b) => b.count - a.count || b.latestAt.getTime() - a.latestAt.getTime());
}

/**
 * Step 4: Generate a short chip text (~6 words) for each top category.
 */
async function generateChipTexts(
  categories: string[],
): Promise<string[]> {
  if (categories.length === 0) return [];

  const client = getClient();

  const systemPrompt = `Du generierst kurze, prägnante Chip-Texte für eine Milchvieh-App.
Jeder Chip-Text ist eine kurze Frage (max. 6 Wörter, Deutsch), die zu einem Oberthema passt.
Beispiele: "Remontierungsrate analysieren", "Zellzahl-Trend prüfen", "Konzeptionsrate verbessern".
Antworte NUR mit einem JSON-Array von Strings (gleiche Reihenfolge wie Eingabe):
["Chip1","Chip2","Chip3"]`;

  const userPrompt = `Generiere je einen Chip-Text für diese Themen: ${JSON.stringify(categories)}`;

  try {
    const msg = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 256,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    });
    const raw = (msg.content[0] as any)?.text ?? "[]";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const result: string[] = JSON.parse(jsonMatch[0]);
      if (Array.isArray(result) && result.length === categories.length) return result;
    }
  } catch (err) {
    logger.warn({ err }, "Chip-Text-Generierung LLM-Fehler");
  }

  // Fallback: use category names directly
  return categories.map((c) => `${c} analysieren`);
}

/**
 * Core logic — can be triggered by in-process scheduler or external cron.
 */
export async function runDailyChipGeneration(): Promise<{
  questionsProcessed: number;
  chipsGenerated: number;
}> {
  try {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // 1. Fetch yesterday's questions
    const rows = await db
      .select({
        questionText: questionLogTable.questionText,
        createdAt: questionLogTable.createdAt,
      })
      .from(questionLogTable)
      .where(
        and(
          gte(questionLogTable.createdAt, yesterday),
          lt(questionLogTable.createdAt, today),
        ),
      )
      .orderBy(desc(questionLogTable.createdAt));

    if (rows.length === 0) {
      logger.info("Chip-Scheduler: Keine Fragen gestern — überspringe.");
      return { questionsProcessed: 0, chipsGenerated: 0 };
    }

    const questions = rows.map((r) => ({
      text: r.questionText,
      createdAt: r.createdAt,
    }));

    // 2. Categorise via LLM
    const categorised = await categoriseQuestions(questions);

    // 3. Rank categories
    const ranked = rankCategories(categorised);
    const top3 = ranked.slice(0, 3);

    if (top3.length === 0) {
      return { questionsProcessed: rows.length, chipsGenerated: 0 };
    }

    // 4. Generate chip texts
    const chipTexts = await generateChipTexts(top3.map((c) => c.category));

    // 5. Write to DB — valid_date = tomorrow (today + 1)
    const validDate = new Date(now);
    validDate.setDate(validDate.getDate() + 1);
    const validDateStr = validDate.toISOString().slice(0, 10);

    // Remove old chips for this valid_date first (idempotent re-run)
    await db.execute(
      sql`DELETE FROM daily_chip_suggestions WHERE valid_date = ${validDateStr}::date`,
    );

    const inserts = top3.map((cat, i) => ({
      chipText: chipTexts[i] ?? `${cat.category} analysieren`,
      category: cat.category,
      rank: i + 1,
      validDate: validDateStr,
    }));

    await db.insert(dailyChipSuggestionsTable).values(inserts);

    logger.info(
      { chips: inserts.map((c) => c.chipText), validDate: validDateStr },
      "Tages-Chips generiert",
    );

    return { questionsProcessed: rows.length, chipsGenerated: inserts.length };
  } catch (err) {
    logger.error({ err }, "Chip-Scheduler Fehler");
    return { questionsProcessed: 0, chipsGenerated: 0 };
  }
}

/**
 * Start the in-process nightly scheduler (checks hourly, runs at 02:00).
 */
export function startChipScheduler(): void {
  logger.info("Chip-Scheduler gestartet (stündliche Prüfung, läuft um 02:00)");
  setInterval(
    () => {
      const h = new Date().getHours();
      if (h !== 2) return;
      runDailyChipGeneration().catch((err) =>
        logger.error({ err }, "Chip-Scheduler Ausnahmefehler"),
      );
    },
    60 * 60 * 1000,
  );
}

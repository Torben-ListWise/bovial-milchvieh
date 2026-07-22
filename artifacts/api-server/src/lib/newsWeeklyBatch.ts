/**
 * Weekly news batch generator.
 *
 * Generates 7 newsletter_editions drafts (one per day of the coming week) using
 * cyclic topic rotation from the news_topics table. Each edition is generated via
 * an Anthropic API call that produces app body, social body, CTA suggestion, and
 * a title — all in German, evergreen-style dairy-farming content.
 *
 * Idempotent: skips if drafts already exist for the coming week's date range.
 *
 * Two execution paths:
 *   1. In-process weekly check (Sunday at 22:00 server time)
 *   2. POST /api/admin/cron/run-news-batch with CRON_SECRET header
 */

import Anthropic from "@anthropic-ai/sdk";
import { asc, and, gte, lte, eq, sql } from "drizzle-orm";
import { db, pool, newsTopicsTable, newsletterEditionsTable } from "@workspace/db";
import { logger } from "./logger";
import { getModelForTask } from "./agent";
import { validateUrl } from "./scraper";
import { embedQuery } from "./embeddings";
import { sendNewsletterEdition, fireEmail } from "./emailService";
import * as cheerio from "cheerio";
import { filterKpiTiles } from "./newsKpiUtils";

export { filterKpiTiles } from "./newsKpiUtils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY ist nicht konfiguriert");
  return new Anthropic({ apiKey });
}

/**
 * Returns 7 dates for the coming week, always starting on the next Monday
 * after today (or today itself if today is Monday), optionally offset by
 * whole weeks.  `offsetWeeks = 0` means "the current or immediately-coming
 * Monday-based week", `offsetWeeks = 1` means the week after that.
 *
 * When `startFromToday = true` (used for tests/manual trigger) it uses today
 * as the first day instead of the next Monday boundary.
 */
function nextWeekDates(offsetDays = 1): Date[] {
  // offsetDays is kept for backward compat: 0 = today, 1 = tomorrow, etc.
  // We snap to the Monday of the week that contains `today + offsetDays`.
  const anchor = new Date();
  anchor.setHours(0, 0, 0, 0);
  anchor.setDate(anchor.getDate() + offsetDays);

  if (offsetDays === 0) {
    // Test mode: just start from today (no week snapping)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(anchor);
      d.setDate(anchor.getDate() + i);
      return d;
    });
  }

  // Snap anchor forward to the nearest Monday
  const dow = anchor.getDay(); // 0=Sun, 1=Mon … 6=Sat
  const daysToMonday = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  anchor.setDate(anchor.getDate() + daysToMonday);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() + i);
    return d;
  });
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; MilchviehBot/1.0; +https://bovial.com)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
};

/**
 * Fetch plain text from a URL.
 * SSRF-safe: validates EVERY redirect hop against private/internal addresses.
 * Returns empty string on any error or blocked address.
 */
async function fetchUrlText(url: string): Promise<string> {
  try {
    let current = url;
    for (let hop = 0; hop <= 5; hop++) {
      // SSRF guard: reject private/internal addresses on every hop
      await validateUrl(current);

      let resp: Response;
      try {
        resp = await fetch(current, {
          headers: FETCH_HEADERS,
          redirect: "manual",
          signal: AbortSignal.timeout(12_000),
        });
      } catch {
        return "";
      }

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get("location");
        if (!location) return "";
        try {
          current = new URL(location, current).href;
        } catch {
          return "";
        }
        continue;
      }

      if (!resp.ok) return "";
      const html = await resp.text();
      const $ = cheerio.load(html);
      $("script, style, nav, header, footer, aside, noscript").remove();
      return $("body").text().replace(/\s+/g, " ").trim().slice(0, 3000);
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Search DuckDuckGo for recent content about the given topic in German.
 * Returns up to `limit` safe-fetched text snippets.
 */
async function searchWebForTopic(
  topic: string,
  limit = 2,
): Promise<{ url: string; text: string }[]> {
  const query = encodeURIComponent(`Milchvieh ${topic} aktuell`);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${query}&kl=de-de`;
  const results: { url: string; text: string }[] = [];

  try {
    // DDG HTML endpoint - no API key needed
    await validateUrl(searchUrl);
    let ddgHtml: string;
    try {
      const resp = await fetch(searchUrl, {
        headers: {
          ...FETCH_HEADERS,
          // DDG requires Accept: text/html
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok && resp.status < 300) return results;
      ddgHtml = await resp.text();
    } catch {
      return results;
    }

    // Extract result URLs from DDG's HTML structure
    const $ = cheerio.load(ddgHtml);
    const urls: string[] = [];
    $("a.result__a").each((_i, el) => {
      const href = $(el).attr("href");
      if (href && href.startsWith("http") && urls.length < limit * 2) {
        urls.push(href);
      }
    });

    // Fallback: also check result__url spans with data-href or plain links
    if (urls.length === 0) {
      $("a[href]").each((_i, el) => {
        const href = $(el).attr("href");
        if (
          href &&
          href.startsWith("http") &&
          !href.includes("duckduckgo.com") &&
          urls.length < limit * 2
        ) {
          urls.push(href);
        }
      });
    }

    // Fetch each result URL safely, collect the first `limit` that have content
    for (const url of urls.slice(0, limit * 2)) {
      if (results.length >= limit) break;
      const text = await fetchUrlText(url);
      if (text.length > 150) {
        results.push({ url, text });
      }
    }
  } catch {
    // ignore — web search is best-effort
  }

  return results;
}

export interface KnowledgeSource {
  index: number;
  title: string;
  url: string | null;
}

interface KnowledgeContextResult {
  context: string;
  sources: KnowledgeSource[];
}

/**
 * Query the knowledge library for chunks relevant to a given topic.
 * Returns both formatted context text and structured source references.
 * Uses vector similarity search; falls back to empty result on error.
 */
async function fetchKnowledgeContext(topic: string): Promise<KnowledgeContextResult> {
  try {
    const queryVec = await embedQuery(topic);
    const vecStr = `[${queryVec.join(",")}]`;
    const rows = await db.execute(
      sql`
        SELECT kc.chunk_text, kd.title, kd.source_url
        FROM knowledge_chunks kc
        JOIN knowledge_documents kd ON kd.id = kc.doc_id
        WHERE kd.status = 'ready'
        ORDER BY kc.embedding <=> ${vecStr}::vector
        LIMIT 4
      `,
    ) as { rows: { chunk_text: string; title: string; source_url: string | null }[] };

    if (!rows.rows || rows.rows.length === 0) return { context: "", sources: [] };

    const sources: KnowledgeSource[] = rows.rows.map((r, i) => ({
      index: i,
      title: r.title,
      url: r.source_url ?? null,
    }));

    const context = rows.rows
      .map((r, i) => `[Quelle ${i}: ${r.title}]: ${r.chunk_text.slice(0, 600)}`)
      .join("\n\n");

    return { context, sources };
  } catch {
    return { context: "", sources: [] };
  }
}

// ---------------------------------------------------------------------------
// Core generation
// ---------------------------------------------------------------------------

interface GeneratedEdition {
  title: string;
  appBody: string;
  socialBody: string;
  /** Unified, ordered list: knowledge sources first (matching kpiTiles indices 0..K-1), web sources after */
  sources: { name: string; url: string }[];
  ctaType: "route" | "chat_prompt";
  ctaTarget: string;
  kpiTiles: { value: string; label: string; sourceIndex: number }[];
  causeEffect: string[] | null;
  checklist: string[];
}

const TOPIC_CTA_MAP: Record<string, { type: "route" | "chat_prompt"; target: string }> = {
  "Eutergesundheit": { type: "route", target: "/app/analyses" },
  "Fruchtbarkeit": { type: "route", target: "/app/analyses" },
  "Klauengesundheit": { type: "route", target: "/app/warnings" },
  "Hitzestress": {
    type: "chat_prompt",
    target:
      "Wie kann ich meine Herde optimal vor Hitzestress schützen? Bitte analysiere meine aktuellen Daten.",
  },
  "Fütterung": {
    type: "chat_prompt",
    target:
      "Analysiere meine Fütterungseffizienz und zeige Optimierungspotenzial auf.",
  },
  "Technik/Digitalisierung": {
    type: "chat_prompt",
    target:
      "Welche digitalen Lösungen könnten meinen Betrieb am stärksten verbessern?",
  },
};

async function generateEdition(
  topic: string,
  sourceUrls: string[],
  scheduledDate: string,
): Promise<GeneratedEdition> {
  const client = getAnthropicClient();

  // Fetch configured source URLs, run web search, and query knowledge library — all in parallel
  const [urlContentsRaw, webSearchResults, knowledgeResult] = await Promise.all([
    (async () => {
      const results: { url: string; text: string }[] = [];
      for (const url of sourceUrls.slice(0, 2)) {
        const text = await fetchUrlText(url);
        if (text.length > 100) results.push({ url, text });
      }
      return results;
    })(),
    searchWebForTopic(topic, 2),
    fetchKnowledgeContext(topic),
  ]);

  const { context: knowledgeContext, sources: knowledgeSources } = knowledgeResult;

  // Merge configured + web-search results, de-duplicate by URL, keep first 4
  const seen = new Set<string>();
  const allUrlContents: { url: string; text: string }[] = [];
  for (const item of [...urlContentsRaw, ...webSearchResults]) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      allUrlContents.push(item);
    }
    if (allUrlContents.length >= 4) break;
  }

  const sourceContext =
    allUrlContents.length > 0
      ? allUrlContents
          .map(
            (u, i) =>
              `--- Quelle ${i + 1}: ${u.url} ---\n${u.text.slice(0, 1200)}`,
          )
          .join("\n\n")
      : "(Keine externen Quellen verfügbar — bitte auf allgemeines Fachwissen zurückgreifen)";

  const knowledgeSection = knowledgeContext
    ? `\nWissensbibliothek (betriebsrelevante Fachinformationen zum Thema — NUR diese Quellen als Grundlage für kpiTiles verwenden):\n${knowledgeContext}`
    : "";

  const knowledgeSourcesJson = knowledgeSources.length > 0
    ? `\nVerfügbare Wissensbibliothek-Quellen für kpiTiles (Indices 0–${knowledgeSources.length - 1}):\n${JSON.stringify(knowledgeSources.map((s) => ({ index: s.index, title: s.title })))}`
    : "";

  const ctaSuggestion =
    TOPIC_CTA_MAP[topic] ??
    ({
      type: "chat_prompt",
      target: `Zeige mir aktuelle Kennzahlen zum Thema ${topic} und gib Empfehlungen.`,
    } as const);

  const kpiTilesInstruction = knowledgeContext
    ? `"kpiTiles": [{"value": "Kennzahl mit Einheit", "label": "Bezeichnung", "sourceIndex": 0}] — maximal 4 Kacheln, NUR Zahlen aus der Wissensbibliothek (sourceIndex muss auf einen der verfügbaren Indices verweisen)`
    : `"kpiTiles": [] — keine Wissensbibliothek verfügbar, daher LEER lassen`;

  const prompt = `Du bist Redakteur für einen deutschen Milchvieh-Informationsdienst. Erstelle eine eigenständige, fachlich fundierte Nachrichtenausgabe für Landwirte zum Thema: **${topic}**.

Zieldatum der Ausgabe: ${scheduledDate}

Verfügbare Quellinhalte (nur als Grundlage für eigene Formulierungen verwenden, kein wörtliches Zitieren über 15 Wörter):
${sourceContext}${knowledgeSection}${knowledgeSourcesJson}

Aufgabe: Erstelle EXAKT folgendes JSON-Objekt (kein weiterer Text darum):
{
  "title": "Prägnanter Titel der Ausgabe (max. 10 Wörter)",
  "appBody": "2–3 kurze Absätze fließend formuliert (ca. 300–400 Wörter gesamt) plus ein abgesetzter Schlussabsatz der mit 'Handlungsempfehlung:' beginnt. Evergreen-Inhalt, lehrreich und praxisnah. Keine Markdown-Überschriften. Absätze durch Leerzeile getrennt.",
  "socialBody": "3–4 prägnante Sätze (ca. 120–180 Wörter), eigenständig formuliert, für Social Media. Kein Link, kein Hashtag. Quellenname darf nur als reiner Text genannt werden.",
  "sources": [{"name": "Institutionsname", "url": "vollständige URL"}],
  "ctaType": "${ctaSuggestion.type}",
  "ctaTarget": ${JSON.stringify(ctaSuggestion.target)},
  ${kpiTilesInstruction},
  "causeEffect": ["Ursache-Formulierung", "Wirkung-Formulierung", "Ergebnis-Formulierung"] — genau 3 Strings die eine Ursache-Wirkung-Kette beschreiben, oder null wenn nicht passend,
  "checklist": ["Handlungsempfehlung 1", "Handlungsempfehlung 2"] — 2–4 konkrete Handlungsempfehlungen für Landwirte
}

Wichtig:
- Strenge Copyright-Vorgaben: kein wörtliches Zitat über 15 Wörter, eigenständige Formulierung
- Sprache: Deutsch, sachlich-freundlicher Tonfall für praktizierende Landwirte
- Wenn keine externen Quellen nutzbar: Fachwissen direkt verwenden, sources: []
- kpiTiles DARF NUR Zahlen enthalten, die direkt aus der Wissensbibliothek stammen. Wenn keine Wissensbibliothek vorhanden: kpiTiles: []
- Antworte NUR mit dem JSON, kein Markdown-Codeblock`;

  const response = await client.messages.create({
    model: getModelForTask("newsletter_generation"),
    max_tokens: 1600,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText =
    response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("") ?? "";

  // Extract JSON from response (handle accidental markdown fences)
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Kein JSON in Antwort für Thema "${topic}": ${rawText.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as GeneratedEdition & {
    kpiTiles?: unknown;
    causeEffect?: unknown;
    checklist?: unknown;
  };

  // Ensure required fields
  if (!parsed.title || !parsed.appBody || !parsed.socialBody) {
    throw new Error(`Unvollständige Antwort für Thema "${topic}"`);
  }

  // Normalise sources: only include entries with valid URLs from our known list
  const validSources = (parsed.sources ?? []).filter(
    (s) => s.name && s.url && s.url.startsWith("http"),
  );

  // Validate kpiTiles: only allow if knowledge context was present and sourceIndex is in range
  const maxSourceIndex = knowledgeSources.length - 1;
  const rawKpiTiles = Array.isArray(parsed.kpiTiles) ? parsed.kpiTiles : [];
  const validKpiTiles = filterKpiTiles(rawKpiTiles, knowledgeContext, maxSourceIndex);

  // Log a warning when the knowledge library was available but the LLM returned no usable tiles
  if (knowledgeContext) {
    if (rawKpiTiles.length > 0 && validKpiTiles.length === 0) {
      logger.warn(
        { topic, rawKpiTiles },
        "News-Batch: LLM kpiTiles alle ungültig (sourceIndex out of range oder falscher Typ)",
      );
    } else if (rawKpiTiles.length === 0) {
      logger.warn(
        { topic },
        "News-Batch: LLM hat trotz vorhandener Wissensbibliothek keine kpiTiles zurückgegeben",
      );
    }
  }

  const rawCauseEffect = Array.isArray(parsed.causeEffect) ? parsed.causeEffect : null;
  const validCauseEffect =
    rawCauseEffect && rawCauseEffect.length === 3 && rawCauseEffect.every((s) => typeof s === "string")
      ? (rawCauseEffect as string[])
      : null;

  const rawChecklist = Array.isArray(parsed.checklist) ? parsed.checklist : [];
  const validChecklist = rawChecklist
    .filter((s): s is string => typeof s === "string")
    .slice(0, 6);

  // Build a unified, ordered source list.
  // Knowledge sources occupy indices 0..K-1 (matching kpiTile.sourceIndex values).
  // Web sources follow at indices K..M so they appear in the rendered source list
  // but are not referenced by kpiTiles.
  const knowledgeSourceEntries = knowledgeSources.map((k) => ({
    name: k.title,
    url: k.url ?? "",
  }));
  const unifiedSources = [...knowledgeSourceEntries, ...validSources];

  return {
    title: parsed.title,
    appBody: parsed.appBody,
    socialBody: parsed.socialBody,
    sources: unifiedSources,
    ctaType: parsed.ctaType === "route" ? "route" : "chat_prompt",
    ctaTarget: parsed.ctaTarget ?? ctaSuggestion.target,
    kpiTiles: validKpiTiles,
    causeEffect: validCauseEffect,
    checklist: validChecklist,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BatchRunResult {
  generated: number;
  skipped: number;
  errors: string[];
  dates: string[];
}

/**
 * Run the weekly batch. Pass `offsetDays = 0` to start from today (for testing).
 *
 * `force = true` re-generates editions that already exist in the date range,
 * EXCEPT those that already have kpiTiles populated from a knowledge source —
 * those are always preserved to prevent overwriting valid data with empty arrays.
 */
export async function runNewsWeeklyBatch(
  offsetDays = 1,
  force = false,
): Promise<BatchRunResult> {
  const dates = nextWeekDates(offsetDays);
  const dateStrs = dates.map(toDateStr);
  const batchRunAt = new Date();

  logger.info({ dates: dateStrs, force }, "News-Batch: starte Generierung");

  // Load all active topics ordered by sort_order
  const topics = await db
    .select()
    .from(newsTopicsTable)
    .where(eq(newsTopicsTable.active, true))
    .orderBy(asc(newsTopicsTable.sortOrder));

  if (topics.length === 0) {
    return { generated: 0, skipped: 0, errors: ["Keine aktiven Themen konfiguriert"], dates: dateStrs };
  }

  // Check for existing drafts in the date range (idempotency).
  // When force=true we also fetch kpi_tiles so we can protect editions that
  // already have knowledge-sourced KPI tiles from being overwritten.
  const existingRows = await pool.query<{ scheduled_date: string; kpi_tiles: unknown }>(
    `SELECT scheduled_date::text, kpi_tiles FROM newsletter_editions WHERE scheduled_date >= $1 AND scheduled_date <= $2`,
    [dateStrs[0], dateStrs[6]],
  );

  // Map date → whether the existing edition has non-empty kpiTiles
  const existingEditions = new Map<string, { hasKpiTiles: boolean }>();
  for (const row of existingRows.rows) {
    const tiles = row.kpi_tiles;
    const hasKpiTiles = Array.isArray(tiles) && tiles.length > 0;
    existingEditions.set(row.scheduled_date, { hasKpiTiles });
  }

  // Determine the "next topic index" for the first date based on the latest existing edition
  const latestRow = await pool.query<{ topic: string }>(
    `SELECT topic FROM newsletter_editions ORDER BY scheduled_date DESC LIMIT 1`,
  );
  let topicCursor = 0;
  if (latestRow.rows[0]?.topic) {
    const lastTopicName = latestRow.rows[0].topic;
    const idx = topics.findIndex((t) => t.name === lastTopicName);
    if (idx >= 0) topicCursor = (idx + 1) % topics.length;
  }

  const result: BatchRunResult = { generated: 0, skipped: 0, errors: [], dates: dateStrs };

  for (const dateStr of dateStrs) {
    const existing = existingEditions.get(dateStr);
    if (existing) {
      if (!force) {
        // Normal run: always skip existing editions (original idempotency)
        result.skipped++;
        topicCursor = (topicCursor + 1) % topics.length;
        continue;
      }
      // Force run: skip editions that already have knowledge-sourced kpiTiles
      if (existing.hasKpiTiles) {
        logger.info(
          { date: dateStr },
          "News-Batch: Ausgabe bereits mit kpiTiles vorhanden — wird nicht überschrieben (force-run)",
        );
        result.skipped++;
        topicCursor = (topicCursor + 1) % topics.length;
        continue;
      }
      // Force run: edition exists but has no kpiTiles — safe to regenerate
      logger.info(
        { date: dateStr },
        "News-Batch: force-run überschreibt Ausgabe ohne kpiTiles",
      );
      await pool.query(
        `DELETE FROM newsletter_editions WHERE scheduled_date = $1`,
        [dateStr],
      );
    }

    const topic = topics[topicCursor % topics.length];
    topicCursor = (topicCursor + 1) % topics.length;

    try {
      logger.info({ date: dateStr, topic: topic.name }, "News-Batch: generiere Ausgabe");
      const edition = await generateEdition(
        topic.name,
        (topic.sourceUrls as string[]) ?? [],
        dateStr,
      );

      await db.insert(newsletterEditionsTable).values({
        scheduledDate: dateStr,
        topic: topic.name,
        topicColor: topic.color,
        topicId: topic.id,
        title: edition.title,
        appBody: edition.appBody,
        socialBody: edition.socialBody,
        sources: edition.sources,
        ctaType: edition.ctaType,
        ctaTarget: edition.ctaTarget,
        kpiTiles: edition.kpiTiles,
        causeEffect: edition.causeEffect ?? undefined,
        checklist: edition.checklist,
        status: "draft",
        batchRunAt,
      });

      result.generated++;
      logger.info(
        { date: dateStr, topic: topic.name },
        "News-Batch: Ausgabe als Entwurf gespeichert (E-Mail-Versand erfolgt erst nach expliziter Freigabe)",
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${dateStr} (${topic.name}): ${msg}`);
      logger.warn({ date: dateStr, topic: topic.name, err }, "News-Batch: Ausgabe fehlgeschlagen");
    }
  }

  logger.info(result, "News-Batch: abgeschlossen");
  return result;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function startNewsScheduler(): void {
  logger.info("News-Batch-Scheduler gestartet (stündliche Prüfung, Sonntag 22 Uhr)");
  setInterval(() => {
    const now = new Date();
    const isSunday = now.getDay() === 0;
    const isTargetHour = now.getHours() === 22;
    if (isSunday && isTargetHour) {
      runNewsWeeklyBatch(1).catch((err) =>
        logger.error({ err }, "News-Batch-Scheduler Fehler"),
      );
    }
  }, 60 * 60 * 1000);
}

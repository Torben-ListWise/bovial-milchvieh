/**
 * Fetcher für amtliche Tierseuchen-/Gesundheitswarnungen.
 *
 * Quellen:
 *   fli       — Friedrich-Loeffler-Institut (bundesweit)
 *   laves_nds — LAVES Niedersachsen (regional, Standort Egestorf)
 *
 * Erweiterung: weitere Bundesland-Quellen können als zusätzliche
 * SOURCE-Einträge ergänzt werden.
 *
 * Gibt bei Fehler leeres Array zurück (fail-safe).
 */

import { createHash } from "crypto";
import { logger } from "./logger";

export interface FetchedAlert {
  sourceKey: string;
  externalId: string;
  topic: string;
  title: string;
  summary: string;
  sourceUrl: string;
  officialDate: string | null;
  affectedSpecies: string[];
}

// ── Themen-Erkennung ──────────────────────────────────────────────────────────

/**
 * topic → affectedSpecies mapping (muss mit disease_catalog übereinstimmen)
 */
const TOPIC_SPECIES: Record<string, string[]> = {
  BTV:             ["milchvieh", "schweine"],
  MKS:             ["milchvieh", "schweine", "geflügel"],
  ASP:             ["schweine"],
  KSP:             ["schweine"],
  Vogelgrippe:     ["geflügel"],
  Newcastle:       ["geflügel"],
  LumpySkin:       ["milchvieh"],
  PferdeKrankheit: ["allgemein"],
  Brucellose:      ["milchvieh", "schweine"],
  Tollwut:         ["allgemein"],
  Schmallenberg:   ["milchvieh"],
  Rinderpest:      ["milchvieh"],
  RHDV:            ["allgemein"],
  Hantavirus:      ["allgemein"],
  allgemein:       ["allgemein"],
};

const TOPIC_PATTERNS: [RegExp, string][] = [
  [/blauzunge|btv[-\s]?\d*/i, "BTV"],
  [/maul[- ]und[- ]klauen|mks\b/i, "MKS"],
  [/afrikanische[n]?\s+schweinepest|asp\b/i, "ASP"],
  [/klassische\s+schweinepest|ksp\b/i, "KSP"],
  [/vogelgrippe|gefl[üu]gelpest|h5n1|h5n2|hpai/i, "Vogelgrippe"],
  [/newcastle/i, "Newcastle"],
  [/lumpy[- ]skin|lsd\b/i, "LumpySkin"],
  [/brustseuche|rhinopneumonie|influenza.*pferd/i, "PferdeKrankheit"],
  [/brucell/i, "Brucellose"],
  [/tollwut/i, "Tollwut"],
  [/blauzungen/i, "BTV"],
  [/schmallenberg/i, "Schmallenberg"],
  [/rinderpest|ppr\b/i, "Rinderpest"],
  [/h[äa]morrhagische.{0,20}kaninchen|rhdv/i, "RHDV"],
  [/hantavirus/i, "Hantavirus"],
];

function detectTopic(text: string): { topic: string; affectedSpecies: string[] } {
  for (const [pattern, topic] of TOPIC_PATTERNS) {
    if (pattern.test(text)) {
      return { topic, affectedSpecies: TOPIC_SPECIES[topic] ?? ["allgemein"] };
    }
  }
  return { topic: "allgemein", affectedSpecies: ["allgemein"] };
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function makeExternalId(sourceKey: string, url: string, title: string): string {
  return createHash("sha256")
    .update(`${sourceKey}::${url}::${title}`)
    .digest("hex")
    .slice(0, 16);
}

function extractDate(html: string): string | null {
  // Deutsches Datum: DD.MM.YYYY
  const m1 = html.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`;
  // ISO: YYYY-MM-DD
  const m2 = html.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; BovialHealthBot/1.0; +https://bovial.app)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

// ── FLI-Fetcher ───────────────────────────────────────────────────────────────

const FLI_BASE = "https://www.fli.de";
const FLI_URL = `${FLI_BASE}/de/aktuelles/tierseuchengeschehen/`;

export async function fetchFliAlerts(): Promise<FetchedAlert[]> {
  try {
    const html = await fetchHtml(FLI_URL);
    const results: FetchedAlert[] = [];

    // FLI listet Artikel typischerweise in <article> oder <li class="..."> Elementen
    // mit <h3>/<h4> Überschriften und <time> oder Textdatum
    const articlePattern =
      /<(?:article|li)[^>]*>([\s\S]*?)<\/(?:article|li)>/gi;

    let match: RegExpExecArray | null;
    while ((match = articlePattern.exec(html)) !== null) {
      const block = match[1];

      // Link + Titel extrahieren
      const linkMatch = block.match(
        /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!linkMatch) continue;

      const rawHref = linkMatch[1];
      const rawTitle = stripHtml(linkMatch[2]);
      if (!rawTitle || rawTitle.length < 10) continue;

      const href = rawHref.startsWith("http")
        ? rawHref
        : `${FLI_BASE}${rawHref}`;

      const officialDate = extractDate(block);
      const { topic, affectedSpecies } = detectTopic(rawTitle + " " + block);
      const externalId = makeExternalId("fli", href, rawTitle);

      // Kurze Zusammenfassung aus Textblock (erste ~200 Zeichen nach dem Link)
      const plainBlock = stripHtml(block);
      const summary =
        plainBlock.length > 30
          ? plainBlock.slice(0, 280).replace(/\s+/g, " ").trim() + "…"
          : rawTitle;

      results.push({
        sourceKey: "fli",
        externalId,
        topic,
        title: rawTitle.slice(0, 255),
        summary: summary.slice(0, 600),
        sourceUrl: href,
        officialDate,
        affectedSpecies,
      });

      if (results.length >= 20) break;
    }

    logger.info({ count: results.length }, "FLI-Alerts gefetcht");
    return results;
  } catch (err) {
    logger.warn({ err }, "FLI-Fetcher Fehler — überspringe");
    return [];
  }
}

// ── LAVES-Fetcher (Niedersachsen) ─────────────────────────────────────────────

const LAVES_BASE = "https://www.laves.niedersachsen.de";
const LAVES_URL = `${LAVES_BASE}/startseite/tiere/tiergesundheit/tiergesundheit-und-tierseuchen/aktuelle-tierseuchengeschehen/`;

export async function fetchLavesAlerts(): Promise<FetchedAlert[]> {
  try {
    const html = await fetchHtml(LAVES_URL);
    const results: FetchedAlert[] = [];

    const articlePattern =
      /<(?:article|li|div)[^>]*class="[^"]*(?:item|entry|news|meldung|beitrag)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|li|div)>/gi;

    let match: RegExpExecArray | null;
    while ((match = articlePattern.exec(html)) !== null) {
      const block = match[1];

      const linkMatch = block.match(
        /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!linkMatch) continue;

      const rawHref = linkMatch[1];
      const rawTitle = stripHtml(linkMatch[2]);
      if (!rawTitle || rawTitle.length < 10) continue;

      const href = rawHref.startsWith("http")
        ? rawHref
        : `${LAVES_BASE}${rawHref}`;

      const officialDate = extractDate(block);
      const { topic, affectedSpecies } = detectTopic(rawTitle + " " + block);
      const externalId = makeExternalId("laves_nds", href, rawTitle);

      const plainBlock = stripHtml(block);
      const summary =
        plainBlock.length > 30
          ? plainBlock.slice(0, 280).replace(/\s+/g, " ").trim() + "…"
          : rawTitle;

      results.push({
        sourceKey: "laves_nds",
        externalId,
        topic,
        title: rawTitle.slice(0, 255),
        summary: summary.slice(0, 600),
        sourceUrl: href,
        officialDate,
        affectedSpecies,
      });

      if (results.length >= 20) break;
    }

    // Fallback: wenn kein strukturiertes Muster gefunden, alle Links parsen
    if (results.length === 0) {
      const linkPattern =
        /<a[^>]+href="([^"]*tiergesundheit[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let lm: RegExpExecArray | null;
      while ((lm = linkPattern.exec(html)) !== null) {
        const rawTitle = stripHtml(lm[2]);
        if (!rawTitle || rawTitle.length < 15) continue;
        const href = lm[1].startsWith("http") ? lm[1] : `${LAVES_BASE}${lm[1]}`;
        const { topic, affectedSpecies } = detectTopic(rawTitle);
        results.push({
          sourceKey: "laves_nds",
          externalId: makeExternalId("laves_nds", href, rawTitle),
          topic,
          title: rawTitle.slice(0, 255),
          summary: rawTitle,
          sourceUrl: href,
          officialDate: null,
          affectedSpecies,
        });
        if (results.length >= 10) break;
      }
    }

    logger.info({ count: results.length }, "LAVES-NDS-Alerts gefetcht");
    return results;
  } catch (err) {
    logger.warn({ err }, "LAVES-NDS-Fetcher Fehler — überspringe");
    return [];
  }
}

// ── Alle Quellen ──────────────────────────────────────────────────────────────

export async function fetchAllHealthAlerts(): Promise<FetchedAlert[]> {
  const [fli, laves] = await Promise.allSettled([
    fetchFliAlerts(),
    fetchLavesAlerts(),
  ]);

  const results: FetchedAlert[] = [];
  if (fli.status === "fulfilled") results.push(...fli.value);
  if (laves.status === "fulfilled") results.push(...laves.value);

  return results;
}

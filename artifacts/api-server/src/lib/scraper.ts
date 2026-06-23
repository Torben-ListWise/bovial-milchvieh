import * as cheerio from "cheerio";
import { logger } from "./logger";
import { extractPdfText } from "./ingest";

const USER_AGENT =
  "Mozilla/5.0 (compatible; MilchviehBot/1.0; +https://replit.com)";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGES = 20;
const CONCURRENCY = 5;
const MAX_REDIRECTS = 10;

export interface ScrapeResult {
  title: string;
  text: string;
  pageCount: number;
}

/**
 * Normalise a hostname for SSRF checks.
 * URL.hostname returns bracketed IPv6 literals like `[::1]` — strip the brackets.
 */
function normalizeHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname.toLowerCase();
}

/**
 * IPv4 and IPv6 private / loopback / link-local ranges.
 * All patterns are matched against the *normalised* (bracket-stripped, lower-cased) hostname.
 */
const PRIVATE_PATTERNS: RegExp[] = [
  // IPv4 loopback
  /^127\.\d+\.\d+\.\d+$/,
  // IPv4 private ranges
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  // IPv4 link-local
  /^169\.254\.\d+\.\d+$/,
  // IPv4 any
  /^0\.0\.0\.0$/,
  // IPv6 loopback
  /^::1$/,
  // IPv6 private (ULA)
  /^f[cd][0-9a-f]{2}:/i,
  // IPv6 link-local
  /^fe[89ab][0-9a-f]:/i,
  // IPv6 all-zeros
  /^::$/,
  // IPv4-mapped / compatible IPv6 (::ffff:127.x or ::127.x)
  /^::ffff:127\./i,
  /^::ffff:10\./i,
  /^::ffff:192\.168\./i,
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./i,
  /^::ffff:169\.254\./i,
];

function isPrivateAddress(normalizedHostname: string): boolean {
  if (normalizedHostname === "localhost") return true;
  return PRIVATE_PATTERNS.some((re) => re.test(normalizedHostname));
}

async function resolvedIpIsPrivate(hostname: string): Promise<boolean> {
  try {
    const { resolve4, resolve6 } = await import("node:dns/promises");
    const addrs: string[] = [];
    try {
      addrs.push(...(await resolve4(hostname)));
    } catch {}
    try {
      addrs.push(...(await resolve6(hostname)));
    } catch {}
    if (addrs.length === 0) return false;
    return addrs.some((addr) => isPrivateAddress(normalizeHostname(addr)));
  } catch {
    return false;
  }
}

async function assertSafe(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Nur http:// und https:// URLs sind erlaubt");
  }
  const norm = normalizeHostname(parsed.hostname);
  if (isPrivateAddress(norm)) {
    throw new Error("Interne oder private URLs sind nicht erlaubt");
  }
  if (await resolvedIpIsPrivate(parsed.hostname)) {
    throw new Error("Interne oder private URLs sind nicht erlaubt");
  }
}

export async function validateUrl(url: string): Promise<void> {
  await assertSafe(url);
}

/**
 * Fetch a page with manual redirect handling.
 * Each redirect target is SSRF-validated before being followed.
 * Returns HTML/text body, or null on any error.
 */
async function fetchPageSafe(url: string): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "manual",
      });
    } catch {
      return null;
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return null;
      }
      // Block non-http(s) redirect targets
      if (next.protocol !== "http:" && next.protocol !== "https:") return null;
      // Block private/loopback redirect targets (check both hostname and resolved IP)
      const normHost = normalizeHostname(next.hostname);
      if (isPrivateAddress(normHost)) return null;
      if (await resolvedIpIsPrivate(next.hostname)) return null;
      current = next.href;
      continue;
    }

    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    return await res.text();
  }
  return null;
}

function extractBody(html: string): string {
  const $ = cheerio.load(html);
  $("nav, header, footer, script, style, aside, noscript, iframe").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function extractTitle(html: string): string {
  const $ = cheerio.load(html);
  return $("title").first().text().trim();
}

function extractLinks(
  html: string,
  rootUrl: string,
  rootHostname: string,
): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (
      !href ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    )
      return;
    try {
      const parsed = new URL(href, rootUrl);
      if (
        parsed.hostname === rootHostname &&
        (parsed.protocol === "http:" || parsed.protocol === "https:")
      ) {
        parsed.hash = "";
        links.push(parsed.href);
      }
    } catch {
      // invalid href — skip
    }
  });
  return [...new Set(links)];
}

async function concurrentFetch(
  urls: string[],
  concurrency: number,
): Promise<Array<string | null>> {
  const results: Array<string | null> = new Array(urls.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const i = idx++;
      results[i] = await fetchPageSafe(urls[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

/**
 * Canonical URL form used for deduplication: lowercase scheme+host, remove trailing slash,
 * drop fragment. Preserves path and query string.
 */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch {
    return raw;
  }
}

/**
 * Fetch a URL and return its body as a Buffer, or null on error.
 * Used for direct PDF URL downloads.
 */
async function fetchBinaryUrlSafe(url: string): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    const arr = await res.arrayBuffer();
    return { buf: Buffer.from(arr), contentType };
  } catch {
    return null;
  }
}

export async function scrapeUrl(rootUrl: string): Promise<ScrapeResult> {
  const parsed = new URL(rootUrl);
  const rootHostname = parsed.hostname;

  // Detect direct PDF URLs (by extension or content-type via HEAD probe)
  const lowerPath = parsed.pathname.toLowerCase();
  if (lowerPath.endsWith(".pdf")) {
    const result = await fetchBinaryUrlSafe(rootUrl);
    if (!result) {
      throw new Error(`Root-URL nicht erreichbar: ${rootUrl}`);
    }
    if (!result.contentType.includes("application/pdf") && !result.contentType.includes("octet-stream")) {
      throw new Error(`URL zeigt nicht auf eine PDF-Datei (Content-Type: ${result.contentType})`);
    }
    const text = await extractPdfText(result.buf);
    if (!text || text.trim().length < 10) {
      throw new Error("Kein Text in der PDF-Datei gefunden");
    }
    const filename = parsed.pathname.split("/").pop()?.replace(/\.pdf$/i, "") || rootHostname;
    return { title: filename, text, pageCount: 1 };
  }

  const rootHtml = await fetchPageSafe(rootUrl);
  if (!rootHtml) {
    throw new Error(`Root-URL nicht erreichbar: ${rootUrl}`);
  }

  const title = extractTitle(rootHtml) || rootHostname;

  // Measure body text separately (without decorative headings) to detect empty pages
  const rootBodyText = extractBody(rootHtml);
  if (!rootBodyText || rootBodyText.length < 10) {
    throw new Error("Kein Text auf der Seite gefunden");
  }

  const subLinks = extractLinks(rootHtml, rootUrl, rootHostname)
    .filter((l) => {
      const norm = canonicalizeUrl(l);
      const rootNorm = canonicalizeUrl(rootUrl);
      return norm !== rootNorm;
    })
    .slice(0, MAX_PAGES - 1);

  const subHtmls = await concurrentFetch(subLinks, CONCURRENCY);

  const parts: string[] = [`=== ${title} ===\n${rootBodyText}`];
  let pageCount = 1;

  for (let i = 0; i < subLinks.length; i++) {
    const html = subHtmls[i];
    if (!html) continue;
    const bodyText = extractBody(html);
    if (!bodyText) continue;
    parts.push(`=== ${subLinks[i]} ===\n${bodyText}`);
    pageCount++;
  }

  return { title, text: parts.join("\n\n"), pageCount };
}

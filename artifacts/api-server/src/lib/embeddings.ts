import { logger } from "./logger";

const EMBEDDING_MODEL = "gemini-embedding-001";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const EMBEDDING_DIMENSIONS = 768;
const CONCURRENCY = 1;
const MAX_CHUNKS = 500;
const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;

function getApiKey(): string {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_API_KEY ist nicht konfiguriert. Bitte hinterlegen Sie Ihren Google API-Schlüssel.",
    );
  }
  return apiKey;
}

export function chunkText(
  text: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): string[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (normalized.length === 0) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + size, normalized.length);
    const chunk = normalized.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    if (end >= normalized.length) break;
    start = end - overlap;
    if (start <= 0) start = end;
  }

  return chunks.slice(0, MAX_CHUNKS);
}

async function embedSingle(text: string, apiKey: string): Promise<number[]> {
  const url = `${GEMINI_API_BASE}/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
  const body = {
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIMENSIONS,
  };

  let attempt = 0;
  const maxRetries = 3;

  while (attempt < maxRetries) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      attempt++;
      const delay = Math.pow(2, attempt) * 1000;
      logger.warn({ attempt, delay }, "Rate-Limit beim Embedding — Retry nach Backoff");
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini Embedding API Fehler ${res.status}: ${errText}`);
    }

    const json = (await res.json()) as { embedding: { values: number[] } };
    return json.embedding.values;
  }

  throw new Error("Gemini Embedding: Maximale Wiederholungsversuche erreicht");
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = getApiKey();
  const results: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const batch = texts.slice(i, i + CONCURRENCY);
    const embeddings = await Promise.all(
      batch.map((text) => embedSingle(text, apiKey)),
    );
    for (let j = 0; j < embeddings.length; j++) {
      results[i + j] = embeddings[j];
    }
  }

  return results;
}

import OpenAI from "openai";
import { logger } from "./logger";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100;
const MAX_CHUNKS = 500;
const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;

export { EMBEDDING_DIMENSIONS };

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY ist nicht konfiguriert. Bitte hinterlegen Sie Ihren OpenAI API-Schlüssel.",
    );
  }
  return new OpenAI({ apiKey });
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

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getOpenAIClient();
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    let attempt = 0;
    const maxRetries = 3;

    while (attempt < maxRetries) {
      try {
        const response = await client.embeddings.create({
          model: EMBEDDING_MODEL,
          input: batch,
        });
        for (const item of response.data) {
          allEmbeddings.push(item.embedding);
        }
        break;
      } catch (err: unknown) {
        attempt++;
        const isRateLimit =
          err instanceof Error &&
          (err.message.includes("429") || err.message.includes("rate"));
        if (isRateLimit && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.warn(
            { attempt, delay },
            "Rate-Limit beim Embedding — Retry nach Backoff",
          );
          await new Promise((r) => setTimeout(r, delay));
        } else {
          throw err;
        }
      }
    }
  }

  return allEmbeddings;
}

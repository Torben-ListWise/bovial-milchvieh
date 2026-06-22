import { pipeline, env } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { logger } from "./logger";

export const EMBEDDING_DIMENSIONS = 768;
export const LOCAL_MODEL_NAME = "multilingual-e5-base";
const HF_MODEL_ID = "Xenova/multilingual-e5-base";

const MAX_CHUNKS = 500;
const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;

// Persist model weights across restarts in a local cache directory
env.cacheDir = "./.hf-cache";

// Singleton: loaded once on warmup, reused for all calls
let _modelPromise: Promise<FeatureExtractionPipeline> | null = null;

function getModel(): Promise<FeatureExtractionPipeline> {
  if (!_modelPromise) {
    _modelPromise = pipeline("feature-extraction", HF_MODEL_ID, {
      dtype: "fp32",
    }) as Promise<FeatureExtractionPipeline>;
  }
  return _modelPromise;
}

/**
 * Pre-load the model at server startup. All embedTexts/embedQuery calls
 * automatically wait for this — but calling warmup early avoids latency
 * on the first real user request.
 */
export async function warmupEmbeddingModel(): Promise<void> {
  try {
    logger.info({ model: HF_MODEL_ID }, "Lade lokales Embedding-Modell...");
    await getModel();
    logger.info(
      { model: HF_MODEL_ID },
      "Embedding-Modell bereit (lokal, kein API-Key nötig)",
    );
  } catch (err) {
    logger.error({ err }, "Embedding-Modell konnte nicht geladen werden");
    throw err;
  }
}

async function embedOne(text: string): Promise<number[]> {
  const model = await getModel();
  // pooling: "mean" + normalize: true handles mean pooling + L2 normalization
  // required by nomic-embed-text-v1.5 for correct cosine similarity
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/**
 * Embed document chunks for ingestion.
 * Uses "passage: " prefix as required by multilingual-e5-base.
 * No rate limiting — runs locally.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embedOne(`passage: ${text}`));
  }
  return results;
}

/**
 * Embed a search query.
 * Uses "query: " prefix as required by multilingual-e5-base for retrieval accuracy.
 */
export async function embedQuery(text: string): Promise<number[]> {
  return embedOne(`query: ${text}`);
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

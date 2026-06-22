import { pipeline, env } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { logger } from "./logger";

export const EMBEDDING_DIMENSIONS = 768;
export const LOCAL_MODEL_NAME = "nomic-embed-text-v1.5";
const HF_MODEL_ID = "Xenova/nomic-embed-text-v1.5";

const MAX_CHUNKS = 500;
const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;

// Persist model weights across restarts in a local cache directory
env.cacheDir = "./.hf-cache";

// Support optional HF token — required to download the gated nomic model
// (user must accept nomic license at huggingface.co/Xenova/nomic-embed-text-v1.5)
if (process.env.HF_TOKEN) {
  env.authToken = process.env.HF_TOKEN;
}

// ────────────────────────────────────────────────────────────────────
// Exported stable promise — resolves when the model is fully loaded.
// Consumers can await embeddingModelReady before calling embed functions.
// All embed functions also await this internally, so direct callers
// never need to worry about ordering.
// ────────────────────────────────────────────────────────────────────
let _resolveReady!: () => void;
let _rejectReady!: (err: unknown) => void;

export const embeddingModelReady: Promise<void> = new Promise<void>(
  (resolve, reject) => {
    _resolveReady = resolve;
    _rejectReady = reject;
  },
);

// Prevent Node.js from crashing with UnhandledPromiseRejection if warmup fails
// before any consumer has attached a .catch() to embeddingModelReady.
embeddingModelReady.catch(() => {});

let _model: FeatureExtractionPipeline | null = null;

async function getModel(): Promise<FeatureExtractionPipeline> {
  await embeddingModelReady;
  return _model!;
}

/**
 * Pre-load the model at server startup. Resolves embeddingModelReady.
 * Call once after app.listen(); all subsequent embedTexts/embedQuery calls
 * automatically block on the returned promise without holding the server.
 */
export async function warmupEmbeddingModel(): Promise<void> {
  logger.info({ model: HF_MODEL_ID }, "Lade lokales Embedding-Modell...");
  try {
    _model = (await pipeline("feature-extraction", HF_MODEL_ID, {
      dtype: "fp32",
    })) as FeatureExtractionPipeline;
    _resolveReady();
    logger.info(
      { model: HF_MODEL_ID },
      "Embedding-Modell bereit (lokal, kein API-Key nötig)",
    );
  } catch (err) {
    _rejectReady(err);
    logger.error({ err }, "Embedding-Modell konnte nicht geladen werden");
    throw err;
  }
}

async function embedOne(text: string): Promise<number[]> {
  const model = await getModel();
  // Mean pooling + L2 normalization — mandatory for nomic-embed-text-v1.5
  // (cosine similarity is undefined without normalization)
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/**
 * Embed document chunks for ingestion.
 * Uses "search_document: " prefix as required by nomic-embed-text-v1.5.
 * No rate limiting — runs locally.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embedOne(`search_document: ${text}`));
  }
  return results;
}

/**
 * Embed a search query.
 * Uses "search_query: " prefix for nomic-embed-text-v1.5 retrieval accuracy.
 */
export async function embedQuery(text: string): Promise<number[]> {
  return embedOne(`search_query: ${text}`);
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

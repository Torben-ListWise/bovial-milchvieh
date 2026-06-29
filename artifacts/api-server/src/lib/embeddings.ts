import { pipeline, env } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { fileURLToPath } from "url";
import path from "path";
import { logger } from "./logger";

export const EMBEDDING_DIMENSIONS = 768;
export const LOCAL_MODEL_NAME = "multilingual-e5-base";
// nomic-embed-text-v1.5 ONNX requires onnx-community license acceptance (gated).
// multilingual-e5-base is fully public, 768-dim, excellent German support.
const HF_MODEL_ID = "Xenova/multilingual-e5-base";

const MAX_CHUNKS = 500;
const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;

// Use an ABSOLUTE path derived from import.meta.url so the cache works
// regardless of process.cwd(). In the esbuild ESM bundle (dist/index.mjs),
// import.meta.url = file:///…/artifacts/api-server/dist/index.mjs, so
// resolving "../.hf-cache" lands at artifacts/api-server/.hf-cache — correct
// in both dev and production deployment.
const HF_CACHE_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  ".hf-cache",
);

env.cacheDir = HF_CACHE_DIR;
env.localModelPath = HF_CACHE_DIR;
env.allowRemoteModels = false;

// Log so we can verify the resolved path in production logs.
// eslint-disable-next-line no-console
console.log(`[embeddings] HF cache dir resolved to: ${HF_CACHE_DIR}`);

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

    // Run a small dummy inference to prime the ONNX JIT so the first real
    // user request does not incur the ~18 s cold-start penalty.
    logger.info({ model: HF_MODEL_ID }, "Embedding-Modell geladen — starte ONNX-Warmup-Inferenz...");
    const t0 = Date.now();
    await _model("warmup", { pooling: "mean", normalize: true });
    const ms = Date.now() - t0;
    logger.info(
      { model: HF_MODEL_ID, warmupMs: ms },
      "ONNX-Warmup abgeschlossen — Modell ist heiß und bereit",
    );

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
 * Uses "query: " prefix for multilingual-e5-base retrieval accuracy.
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

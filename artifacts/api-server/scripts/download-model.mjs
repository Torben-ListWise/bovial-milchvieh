/**
 * Pre-downloads the Xenova/multilingual-e5-base embedding model into the
 * local .hf-cache directory so the server starts instantly without needing
 * to fetch ~280 MB from HuggingFace on first use.
 *
 * Run automatically via the `postinstall` script in package.json whenever
 * `pnpm install` is executed. Safe to run repeatedly —
 * exits immediately if the model files are already present.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.resolve(__dirname, "..");
const CACHE_DIR = path.resolve(ARTIFACT_DIR, ".hf-cache");
const MODEL_ID = "Xenova/multilingual-e5-base";
const MODEL_ONNX = path.join(CACHE_DIR, MODEL_ID, "onnx", "model.onnx");

async function downloadModel() {
  if (existsSync(MODEL_ONNX)) {
    console.log(
      `[download-model] Model already cached at ${CACHE_DIR} — skipping download.`,
    );
    return;
  }

  console.log(
    `[download-model] Downloading ${MODEL_ID} to ${CACHE_DIR} (first time, ~280 MB)…`,
  );

  const { pipeline, env } = await import("@huggingface/transformers");

  env.cacheDir = CACHE_DIR;
  env.allowRemoteModels = true;

  await pipeline("feature-extraction", MODEL_ID, { dtype: "fp32" });

  console.log(`[download-model] Model downloaded and cached at ${CACHE_DIR}.`);
}

downloadModel().catch((err) => {
  console.error("[download-model] Failed to download model:", err);
  process.exit(1);
});

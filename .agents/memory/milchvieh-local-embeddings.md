---
name: Milchvieh local embeddings
description: Local embedding model setup — which model works, which doesn't, and required text prefixes
---

## Rule
Use `Xenova/multilingual-e5-base` via `@huggingface/transformers` for all embeddings.

**Why:** `Xenova/nomic-embed-text-v1.5` was the original spec target but no longer exists — Xenova org renamed to `onnx-community`. `onnx-community/nomic-embed-text-v1.5` is a gated model requiring separate license acceptance at onnx-community (even with HF_TOKEN set), returns 404 for the @huggingface/transformers library when license not accepted. `multilingual-e5-base` is fully open (307 without auth), 768-dim, proven to work for German dairy content.

## Required text prefixes (multilingual-e5 convention)
- Document ingestion: `passage: <text>`
- Query at search time: `query: <text>`

Wrong prefixes silently degrade retrieval quality.

## How to apply
- `LOCAL_MODEL_NAME = "multilingual-e5-base"` (stored in DB `embedding_model` column)
- `HF_MODEL_ID = "Xenova/multilingual-e5-base"` in embeddings.ts
- Dimensions: 768 — matches HNSW index and existing schema
- Cache: MUST use absolute path via `import.meta.url` — relative `./.hf-cache` fails in production where CWD differs. Pattern: `path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '.hf-cache')`
- First load: ~5s from disk cache (model is 1.1GB ONNX, pre-downloaded at build time)
- `HF_TOKEN` secret is set but not needed for this model (can be ignored)

## Exported embeddingModelReady promise
- `embeddingModelReady: Promise<void>` exported from embeddings.ts
- Resolves when warmup completes, rejects on failure
- Has `.catch(() => {})` guard to prevent unhandled rejection crashing Node.js v24
- All embed functions await this internally — callers don't need to worry about ordering
- `warmupEmbeddingModel()` called after `app.listen()` so server is already accepting requests

## Re-embedding migration (reembedLegacyDocs in index.ts)
- On startup: after warmup, drops HNSW index, re-ingests each legacy doc (embedding_model IS NULL or != LOCAL_MODEL_NAME), recreates HNSW index
- `ingestKnowledgeDoc()` is atomic per doc: delete old chunks → embed → insert → set embedding_model
- Docs in `error` state ARE now auto-retried on startup (`resumePendingIngestions` in index.ts handles both `pending` and `error`)

---
name: Milchvieh local embeddings
description: Local embedding model setup — which model works, which doesn't, and required text prefixes
---

## Rule
Use `Xenova/multilingual-e5-base` via `@huggingface/transformers` for all embeddings.

**Why:** `Xenova/nomic-embed-text-v1.5` is a gated HuggingFace model requiring account consent — returns HTTP 401 from Replit even though the model is "public". `multilingual-e5-base` is genuinely open, returns 307→CDN without auth, and has excellent German-language support (critical for dairy farm content).

## Required text prefixes (e5-base convention)
- Document ingestion: `passage: <text>`
- Query at search time: `query: <text>`

Wrong prefixes silently degrade retrieval quality.

## How to apply
- `LOCAL_MODEL_NAME = "multilingual-e5-base"` (stored in DB `embedding_model` column)
- `HF_MODEL_ID = "Xenova/multilingual-e5-base"` in embeddings.ts
- Dimensions: 768 — matches HNSW index and existing schema
- Cache: `env.cacheDir = "./.hf-cache"` (relative to process CWD = api-server root)
- First load: ~26s (model download ~280MB ONNX); subsequent loads from disk cache
- `embedTexts()` uses `passage:` prefix; `embedQuery()` uses `query:` prefix

## Migration logic (markLegacyDocsForReembedding)
- On startup: docs where `embedding_model IS NULL OR embedding_model != LOCAL_MODEL_NAME` and `status = 'ready'` are reset to `pending` for re-ingestion
- Docs stuck in `processing` state (e.g. from crashed URL scrapes) must be manually reset to `pending` via SQL — the migration only targets `ready` docs

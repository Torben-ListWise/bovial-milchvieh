---
name: Milchvieh Embeddings
description: Embedding model, API setup, and ingestion pipeline details for knowledge library
---

## Embedding model
- Model: `gemini-embedding-001` (NOT `text-embedding-004` — not available for this API key)
- API: Direct REST call to `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent`
- Dimensions: 768 (via `outputDimensionality: 768` in request body)
- `@google/generative-ai` SDK uses v1beta but `text-embedding-004` is not available there either

**Why:** `text-embedding-004` returns 404 for both v1 and v1beta for this API key. Available models for this key: `gemini-embedding-001`, `gemini-embedding-2-preview`, `gemini-embedding-2`.

## Rate limit handling
- CONCURRENCY must be 1 (not 5+) — parallel per-chunk calls immediately saturate the free-tier quota
- `resumePendingIngestions` must be sequential (await each doc, 2s delay between) — parallel startup ingestion causes rate limit cascade
- 3 retries with exponential backoff (2s → 4s → 8s) per chunk

## DB schema
- `knowledge_chunks.embedding` column: `vector(768)` — matches outputDimensionality
- Drop+recreate table when changing vector dimensions (ALTER not supported by drizzle push)

## Startup auto-ingest
- `resumePendingIngestions()` runs on server start and awaits each pending doc sequentially
- Catches per-doc errors and continues to next doc

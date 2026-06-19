---
name: Milchvieh knowledge embeddings
description: Embedding model, dimensions, and DB setup for the knowledge library feature
---

# Milchvieh Knowledge Library — Embedding Stack

## Rule
Use OpenAI `text-embedding-3-small` via `OPENAI_API_KEY`. Vector dimension is **1536**. Schema column: `vector(1536)`. HNSW index uses `vector_cosine_ops`.

**Why:** Task spec requires OpenAI, not Google Gemini. Earlier implementation used `@google/generative-ai` with 768-dim `text-embedding-004` and was rejected in code review. The Google API key is present but is for Gemini chat, not embeddings.

## How to apply
- `artifacts/api-server/src/lib/embeddings.ts` — `OpenAI` client, model `text-embedding-3-small`
- `lib/db/src/schema/knowledge.ts` — `vector("embedding", { dimensions: 1536 })`
- HNSW index: `knowledge_chunks USING hnsw (embedding vector_cosine_ops)`
- `CREATE EXTENSION IF NOT EXISTS vector` runs at api-server startup via `ensureExtensions()` in `lib/db/src/migrate.ts`

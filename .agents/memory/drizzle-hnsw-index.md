---
name: Drizzle HNSW index operator class
description: How to define HNSW vector indexes with operator class in Drizzle 0.45.x pgTable schema
---

In Drizzle 0.45.x the `IndexBuilderOn` API for pgTable indexes works as:

- `index(name).on(...columns)` → returns `IndexBuilder`
- `index(name).using(method, ...columns)` → returns `IndexBuilder` directly (operator class included in column expression)

**Rule:** For HNSW indexes on custom vector types, the operator class must go inside the `.using()` call as a `sql` template expression — NOT via a chained `.on()` call (`.on()` does not exist on the result of `.using()`).

**Correct syntax:**
```typescript
import { sql } from "drizzle-orm";

index("knowledge_chunks_embedding_hnsw_idx")
  .using("hnsw", sql`${table.embedding} vector_cosine_ops`)
  .with({ m: 16, ef_construction: 64 })
```

**Wrong syntax (fails TS):**
```typescript
index("name").using("hnsw").on(sql`col vector_cosine_ops`)  // 'on' does not exist on IndexBuilder
```

**Why:** The Replit deployment system introspects the dev DB and generates Drizzle diff migrations for production. If the HNSW index is only in `migrate.ts` (raw SQL) but not in the Drizzle TypeScript schema, Drizzle introspects it from the dev DB, loses the operator class, and generates broken SQL (`USING hnsw ("embedding")` without ops class → "data type vector has no default operator class for access method hnsw").

**How to apply:** Any time a pgvector HNSW or IVFFlat index is added to a Drizzle schema using `customType` for the vector column, use `index().using(method, sql`col ops`)` — the operator class is mandatory and must be embedded in the column SQL expression.

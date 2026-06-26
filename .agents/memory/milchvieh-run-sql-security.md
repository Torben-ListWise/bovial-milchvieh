---
name: Milchvieh run_sql security architecture
description: DB-level security for the run_sql agent tool — restricted role, RLS, transaction isolation, DB-side limits.
---

## Rule
run_sql must execute under the `milchvieh_analyst` PostgreSQL role with RLS enforcing dataset isolation. Never use application-level text-pattern SQL matching — it is bypassable via subqueries/CTEs.

**Why:** Text-pattern matching (e.g. checking for WHERE dataset_id) can be circumvented by nested queries, CTEs, or comment injection. DB-level role + RLS is the only reliable enforcement point.

## How to apply

### DB setup (lib/db/src/migrate.ts → setupAnalystSandbox)
- `milchvieh_analyst`: NOLOGIN, NOSUPERUSER, NOBYPASSRLS
- SELECT granted only on `public.cow_events` and `public.data_rows`
- RLS enabled on both tables; policy: `dataset_id::text = current_setting('app.current_dataset_id', true)`
- Table owner (postgres) bypasses RLS by default → existing app queries unaffected
- `GRANT milchvieh_analyst TO CURRENT_USER` so SET LOCAL ROLE works from app connection
- Called at every server startup (idempotent via DO $$ EXCEPTION WHEN duplicate_object $$)

### run_sql execution (agent.ts execTool)
Per-query transaction lifecycle using `pool.connect()` (not drizzle tx):
1. `BEGIN`
2. `SET LOCAL ROLE milchvieh_analyst` — restricts table access
3. `SET LOCAL app.current_dataset_id = '<datasetId>'` — RLS trigger
4. `SET LOCAL statement_timeout = '10000'` — 10s hard DB timeout
5. Execute `buildLimitedQuery(rawQuery, 500)` — DB-side row cap
6. `ROLLBACK` in finally (always, even on success) — role switch never leaks to pool

### Helper functions in agent.ts
- `containsSemicolonOutsideStrings(query)`: state machine over single-quoted strings, returns true if semicolon found outside string → blocks multi-statement injection (layer 2)
- `buildLimitedQuery(rawQuery, limit)`: appends LIMIT for CTEs, wraps plain SELECTs in `SELECT * FROM (...) _sandbox LIMIT N`, replaces existing LIMIT if > max

### Verified test results
- Test 1: `SELECT COUNT(*) FROM cow_events` (no dataset_id filter) under milchvieh_analyst with dataset_id set → returns only that dataset's rows (51693). DB enforces silently.
- Test 2: `SELECT id FROM users` under milchvieh_analyst → `ERROR: permission denied for table users`

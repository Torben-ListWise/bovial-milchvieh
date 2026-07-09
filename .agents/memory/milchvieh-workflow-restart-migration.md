---
name: Milchvieh workflow restart after migration
description: Why new DB migrations or schema changes silently don't apply until the api-server workflow is restarted
---

The `artifacts/api-server: API Server` workflow command (`pnpm run dev`) builds once and starts a long-running process. If you edit migration code (`lib/db/src/migrate.ts` or schema files) while the workflow is already running, the running process keeps executing the old build — it does not rebuild or re-run migrations on its own.

**Why:** This caused a real bug when adding a new table and column — the code was correct, but the live API server was still running a stale build without them, so every request touching the new table failed as if the migration had never been written.

**How to apply:** After any change to migration code, schema files, or anything `ensureExtensions()`/startup migrations depend on, explicitly restart the `artifacts/api-server: API Server` workflow (don't just trust that edits will take effect). Verify the new table/column actually exists in the DB afterward before relying on it.

---
name: Milchvieh DB migration idempotency
description: How to write idempotent migrations — ADD CONSTRAINT has no IF NOT EXISTS, use CREATE UNIQUE INDEX IF NOT EXISTS instead
---

## Rule
Never use `ALTER TABLE t ADD CONSTRAINT name UNIQUE (...)` in migrations.
Use `CREATE UNIQUE INDEX IF NOT EXISTS name ON t (...)` instead — it is fully idempotent.

**Why:** PostgreSQL's `ADD CONSTRAINT` has no `IF NOT EXISTS` clause. On a second server start the migration throws `42P07` (relation already exists) and crashes the server. Catching the error code is fragile because `42P07` covers many relation types.

**How to apply:** Any time a migration adds a unique constraint, use the `CREATE UNIQUE INDEX IF NOT EXISTS` form. All three regular indexes already use `CREATE INDEX IF NOT EXISTS` — be consistent.

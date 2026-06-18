---
name: lib/db dist rebuild
description: After any schema change in lib/db/src, the dist must be rebuilt or downstream packages get stale type errors
---

Run `pnpm exec tsc -p tsconfig.json` inside `lib/db/` after any schema edit.

**Why:** lib/db is a TypeScript project reference — api-server imports from `lib/db/dist`, not src. Stale dist causes confusing "property does not exist" TS errors that look like schema bugs.

**How to apply:** Any time you edit `lib/db/src/schema/*.ts` or `lib/db/src/index.ts`, rebuild dist before running api-server typecheck.

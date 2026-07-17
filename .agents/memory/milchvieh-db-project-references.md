---
name: Milchvieh DB project references
description: TypeScript project references mean new DB schema exports need `tsc --build` to appear in api-server
---

## The rule
`artifacts/api-server/tsconfig.json` uses `"references": [{ "path": "../../lib/db" }]`.
TypeScript resolves `@workspace/db` from the **compiled declaration files** in `lib/db/dist/`, not from source.

After adding a new file to `lib/db/src/schema/` (and re-exporting from `schema/index.ts`):
```bash
cd lib/db && npx tsc --build
```
Without this, TS reports "has no exported member 'newTable'" even though the source is correct.

**Why:** The `composite: true` + `emitDeclarationOnly: true` tsconfig makes lib/db a project reference. Consumers read the `dist/` declarations, so new exports are invisible until rebuilt.

**How to apply:** Any time a new export is added to `lib/db/src/` and the api-server (or other consumer) fails to find it — rebuild with `tsc --build` in lib/db.

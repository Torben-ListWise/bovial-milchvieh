---
name: Milchvieh objectStorage lazy require
description: objectStorage.ts uses lazy require() for adapter loading — must stay as-is for esbuild bundling to work correctly
---

The `createAdapter()` function in `objectStorage.ts` uses `require("./replitStorageAdapter")` and `require("./hetznerS3Adapter")` as lazy CJS imports. This pattern is intentional:

- esbuild (the production bundler) recognises these `require()` calls and bundles the adapters into `dist/index.mjs`
- The lazy loading prevents the Hetzner adapter (and its S3 deps) from being included when running in Replit mode

**Why:** Changing to `createRequire(import.meta.url)` or ESM dynamic `import()` breaks the esbuild bundle — the adapter modules are not emitted as separate files, so the runtime `require("./replitStorageAdapter")` path fails with MODULE_NOT_FOUND.

**How to apply:** Never refactor these `require()` calls to ESM imports. If you need to run ingest in a standalone script, do not instantiate ObjectStorageService directly — instead call the running server's HTTP API or reset the DB record to `pending` and restart the server (which auto-ingests pending docs at startup).

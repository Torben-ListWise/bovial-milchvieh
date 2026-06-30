---
name: Milchvieh knowledge ingest startup
description: API server auto-ingests knowledge docs with status='pending' at startup; how to retry stuck docs
---

`artifacts/api-server/src/index.ts` runs `ingestKnowledgeDoc()` for every knowledge document with `status='pending'` (and `status='error'`) during server startup, before the HTTP server begins accepting requests.

**To retry a stuck "processing" document:**
1. `UPDATE knowledge_documents SET status='pending', error_message=NULL WHERE id = '<docId>'`
2. Restart the API server workflow — the startup sequence picks it up automatically

**Why CRON_SECRET approach fails in dev:** `CRON_SECRET` is not set in the dev environment (not listed in available secrets), so the `/api/admin/cron/*` endpoints return 503. Use the startup pickup instead.

**Standalone script approach fails:** Running `pnpm tsx <script>` that imports `ingestKnowledgeDoc` gets killed mid-run (SIGPIPE, exit 13) because loading the embedding model in a second process alongside the already-running API server exceeds available memory.

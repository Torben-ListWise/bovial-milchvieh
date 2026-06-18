---
name: Milchvieh PDF extraction
description: How PDF text extraction is implemented and why pdf-parse was abandoned
---

# PDF extraction in api-server

## Rule
Use `pdfjs-dist/legacy/build/pdf.mjs` (legacy build) directly. Do NOT use `pdf-parse` (any version).

**Why:** pdf-parse v1.1.4 bundles old pdfjs versions (v1.9.426 – v2.0.550) that all fail with "bad XRef entry" on Node.js v24 regardless of PDF quality. pdf-parse v2 requires a separate worker file that gets lost during esbuild bundling.

**How to apply:** `pdfjs-dist` is an explicit dependency and marked external in `build.mjs`. The worker path is resolved with `require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")` at call time. `GlobalWorkerOptions.workerSrc` must be set before calling `getDocument`.

## Location
- Implementation: `artifacts/api-server/src/lib/ingest.ts` — `extractPdfText` function
- Test: `artifacts/api-server/src/__tests__/ingest-pdf.test.ts`
- Test runner: `vitest` (run via `pnpm --filter @workspace/api-server test`)

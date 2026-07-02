---
name: Milchvieh SSE auth & callback wiring
description: How SSE streaming auth works + callback wiring rules
---

## Rules

1. **SSE fetch uses cookie-based auth (`requireAuth`), NOT a query-param token.**  
   The `/api/stream` route uses `requireAuth` as middleware (same as all other endpoints). The browser sends session cookies automatically with same-origin requests. Frontend uses `fetch(url, { credentials: "include" })` with no token. The old approach (`verifyToken` + JWT in query param) required a JWKS network call that fails silently in the Replit dev proxy.

2. **The sseWriters registry is in `lib/sseRegistry.ts` — a shared singleton.**  
   Never re-declare it per-route. Every route that calls `processQuestion` in the background must import `sseWriters` from `lib/sseRegistry.ts` and pass `{ onTextDelta, onSourceSearched, onDone }` closures. Missing callbacks = events silently discarded.

3. **`templates.ts` is a separate module from `analyses.ts`.**  
   The template run route (`POST /datasets/:datasetId/templates/:templateId/run`) imports `sseWriters` from `lib/sseRegistry.ts`.

4. **Frontend: every code path that starts an analysis must call `openSseStream(id)`.**  
   Three paths: `createAnalysis.onSuccess`, `ask.onSuccess`, and `onTemplateRun`. All three must call `openSseStream`. Missing `onTemplateRun` meant template runs never connected to SSE.

5. **SSE endpoint needs `res.flushHeaders()` + `flush()` after each write.**  
   The Replit proxy may buffer responses; `flushHeaders()` before the first write and `(res as any).flush?.()` after each `sendEvent()` ensures data reaches the browser immediately.

**Why:** `verifyToken` (JWKS-based) fails silently in Replit dev proxy; `requireAuth` uses the same cookie session as all other endpoints and is proven reliable. Bearer-only auth; sseWriters was module-private (now in shared sseRegistry); three frontend entry points must all open the stream.

**How to apply:** SSE endpoint = `requireAuth` middleware + `credentials:"include"` on the frontend fetch. Any new route that processes a question asynchronously must import `sseWriters` from `lib/sseRegistry.ts` and follow the same callback pattern.

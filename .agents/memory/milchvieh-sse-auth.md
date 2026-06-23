---
name: Milchvieh SSE auth & callback wiring
description: Bugs that broke SSE streaming — Bearer token, missing callbacks in createAnalysis/templates, shared sseRegistry
---

## Rules

1. **SSE fetch must use Bearer token, not cookies.**  
   The app uses `setAuthTokenGetter(() => getToken())` (Clerk JWT), so `requireAuth` reads `Authorization: Bearer <token>`. An SSE `fetch()` with only `credentials:"include"` returns 401 silently. Always call `const token = await getToken()` then `headers["Authorization"] = \`Bearer ${token}\`` before opening the SSE stream.

2. **The sseWriters registry is in `lib/sseRegistry.ts` — a shared singleton.**  
   Never re-declare it per-route. Every route that calls `processQuestion` in the background must import `sseWriters` from `lib/sseRegistry.ts` and pass `{ onTextDelta, onSourceSearched, onDone }` closures. Missing callbacks = events silently discarded.

3. **`templates.ts` is a separate module from `analyses.ts`.**  
   The template run route (`POST /datasets/:datasetId/templates/:templateId/run`) was the primary failure — it had no access to the old module-private registry. After the refactor, it imports `sseWriters` from `lib/sseRegistry.ts`.

4. **Frontend: every code path that starts an analysis must call `openSseStream(id)`.**  
   Three paths: `createAnalysis.onSuccess`, `ask.onSuccess`, and `onTemplateRun`. All three must call `openSseStream`. Missing `onTemplateRun` meant template runs never connected to SSE.

5. **SSE endpoint needs `res.flushHeaders()` + `flush()` after each write.**  
   The Replit proxy may buffer responses; `flushHeaders()` before the first write and `(res as any).flush?.()` after each `sendEvent()` ensures data reaches the browser immediately.

**Why:** Bearer-only auth; sseWriters was module-private (now in shared sseRegistry); three frontend entry points must all open the stream.

**How to apply:** Any new route that processes a question asynchronously must import `sseWriters` from `lib/sseRegistry.ts` and follow the same callback pattern.

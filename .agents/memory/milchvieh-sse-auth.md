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

5. **SSE endpoint needs `socket.setNoDelay(true)` + `X-Replit-Proxy-Buffering: no` + `flush()` after each write.**  
   Three things together make SSE stream in real-time through the Replit dev proxy:
   (a) `socket.setNoDelay(true)` — disables Nagle's algorithm so small token-delta packets are not batched into larger TCP segments.
   (b) `res.set("X-Replit-Proxy-Buffering", "no")` — Replit-specific header, complements `X-Accel-Buffering: no`.
   (c) `if (typeof (res as any).flush === "function") (res as any).flush()` after every `res.write()` — clears compression-middleware buffers.
   Missing any one of these causes deltas to accumulate and arrive as a burst at the end.

**Why:** `verifyToken` (JWKS-based) fails silently in Replit dev proxy; `requireAuth` uses the same cookie session as all other endpoints and is proven reliable. Bearer-only auth; sseWriters was module-private (now in shared sseRegistry); three frontend entry points must all open the stream.

**How to apply:** SSE endpoint = `requireAuth` middleware + `credentials:"include"` on the frontend fetch. Any new route that processes a question asynchronously must import `sseWriters` from `lib/sseRegistry.ts` and follow the same callback pattern.

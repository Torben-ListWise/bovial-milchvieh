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
   Three things together:
   (a) `socket.setNoDelay(true)` — disables Nagle's algorithm.
   (b) `res.set("X-Replit-Proxy-Buffering", "no")` — Replit-specific, complements `X-Accel-Buffering: no`.
   (c) `flush()` after every `res.write()` — clears compression-middleware buffers.

6. **Frontend MUST use native `EventSource`, NOT `fetch`+ReadableStream.**  
   The Replit dev proxy buffers `fetch` response bodies, so all token deltas arrive as one burst at the end. `EventSource` sends `Accept: text/event-stream` and proxies treat it with proper SSE streaming semantics (no buffering).  
   Server MUST send **named** SSE events (`event: <name>\ndata: <json>\n\n`) for `EventSource.addEventListener('name', ...)` to work. Unnamed events (`data: ...` only) use `onmessage` and lose the event-type dispatch.  
   Name the server's error event `agenterror` (not `error`) to avoid clashing with EventSource's built-in `onerror` connection-error handler.  
   Use a `settled` boolean flag inside `doStream` to prevent `onerror` firing after intentional close.

**Why:** `fetch`+ReadableStream confirmed buffering all SSE deltas through Replit proxy regardless of `X-Accel-Buffering`/`socket.setNoDelay`. EventSource is the only approach that streams in real-time through the proxy.

**How to apply:** SSE endpoint = `requireAuth` middleware + named events. Frontend = `new EventSource(url, { withCredentials: true })` + per-event `addEventListener`. Any new route processing questions asynchronously must import from `lib/sseRegistry.ts`.

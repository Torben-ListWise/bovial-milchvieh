---
name: Milchvieh agent streaming
description: How the agent streams text to the client in real-time via SSE
---

## Rule
Use `client.messages.stream()` with `stream.on("text", delta => onTextDelta(delta))` for real-time token-by-token emission. Do NOT use `messages.create()` (non-streaming) — it delivers the entire response as one block.

**Why:** The earlier non-streaming workaround was introduced because `client.messages.stream()` threw errors for claude-sonnet-4-5 in this Replit env. That was a temporary Anthropic server-side issue (2025-06), now resolved.

## SSE endpoint requirements (routes/analyses.ts)
The SSE route MUST set all of the following or events will be buffered:
1. `res.socket.setNoDelay(true)` — disables Nagle's algorithm so small packets (individual text deltas) flush immediately rather than being batched. This is the same technique Vite uses for HMR. Without this, deltas only arrive when a full TCP segment is ready.
2. `Cache-Control: no-cache, no-store, no-transform` — prevents proxy caching
3. `X-Accel-Buffering: no` — nginx-specific
4. `res.flushHeaders()` — sends headers before data
5. Heartbeat `flush()` call — the 10s heartbeat interval must also call `flush()`

**Why:** The Replit dev proxy can buffer SSE responses. setNoDelay(true) is the critical fix — without it, small delta packets batch up at the TCP level and only arrive all at once when a full segment accumulates (typically when the agent finishes and the connection closes).

## createAnalysis route must pass all SSE callbacks
The `setImmediate(() => processQuestion(...))` call in the createAnalysis route must include ALL four callbacks: `onTextDelta`, `onProgress`, `onChart`, `onSourceSearched`. Previously `onProgress` and `onChart` were missing for template runs, so steps only appeared from DB polling.

## How to apply
- In the main turn loop: wrap `client.messages.stream({...})` + `stream.on("text", cb)` + `return stream.finalMessage()` inside `callWithRetry`
- `callWithRetry` is safe because 500/529 errors occur before the first token, so no duplicate delta emission on retry
- The self-verification pass was removed — it caused 15-30s silence
- Tool turns may also emit preamble text; this is acceptable

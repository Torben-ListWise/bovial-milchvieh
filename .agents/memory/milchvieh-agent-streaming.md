---
name: Milchvieh agent streaming
description: How the agent streams text to the client in real-time via SSE
---

## Current approach: SSE via fetch+ReadableStream (NOT EventSource, NOT WebSocket)

**Why NOT EventSource**: EventSource cannot set Authorization headers. Clerk (even dev mode)
returns `dev-browser-missing` and immediately closes the connection with 401. The client's
`onerror` fires, retries 3x, then falls back to 1s polling — no live streaming visible.

**Why NOT WebSocket**: The Replit dev proxy does not forward WS upgrades across artifact ports.

**Why fetch+ReadableStream**: Can set `Authorization: Bearer <token>` header. Uses the same
Clerk JWT that all other API calls use (via `getAuthToken()` from `@workspace/api-client-react`).

## Server endpoint

`GET /api/stream?analysisId=UUID`
- Auth: `requireAuth` middleware reads Bearer JWT via `getAuth(req)` from `@clerk/express`
- Response headers: `Content-Type: text/event-stream`, `X-Accel-Buffering: no`, `X-Replit-Proxy-Buffering: no`
- Named SSE events: `event: <name>\ndata: <json>\n\n`
- Events: `connected`, `delta {text}`, `progress {step}`, `chart {chart}`, `sources {sources}`, `done {}`, `agenterror {message}`
- Keepalive: `: keepalive\n\n` every 10s

## Client hook: use-analysis-stream.ts

```typescript
const token = await getAuthToken();  // from @workspace/api-client-react
const headers: HeadersInit = { "Accept": "text/event-stream" };
if (token) headers["Authorization"] = `Bearer ${token}`;
const response = await fetch(url, { headers, credentials: "include", signal: controller.signal });
```

SSE buffer parsed manually: split on `\n\n`, extract `event:` and `data:` fields per block.

**How to apply:**
- Never switch back to EventSource — it will always fail Clerk auth in dev mode
- `getAuthToken()` must be exported from `lib/api-client-react/src/index.ts` AND `dist/index.d.ts`
- AbortController replaces es.close() for cancellation; retry logic (3x backoff) unchanged

## Agent streaming internals

Use `client.messages.stream()` with `stream.on("text", delta => onTextDelta!(delta))` for token-by-token emission.

**How to apply:**
- In the main turn loop: `client.messages.stream({...})` + `stream.on("text", cb)` + `return stream.finalMessage()`
- `callWithRetry` is safe — 500/529 errors occur before first token
- The self-verification pass was removed — it caused 15-30s silence
- All 4 SSE callbacks must be passed to `processQuestion`: `onTextDelta`, `onProgress`, `onChart`, `onSourceSearched`

## createAnalysis route (template runs)
Must also pass all 4 callbacks in `setImmediate(() => processQuestion(..., { onTextDelta, onSourceSearched, onProgress, onChart, onDone }))`.

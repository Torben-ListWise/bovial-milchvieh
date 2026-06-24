---
name: Milchvieh agent streaming
description: How the agent streams text to the client in real-time via WebSocket
---

## Current approach: WebSocket (not SSE)

**Why WebSocket, not SSE**: The Replit proxy buffers SSE responses regardless of `setNoDelay(true)`, `X-Replit-Proxy-Buffering: no`, `X-Accel-Buffering: no`, or any other HTTP headers. Text arrives all at once when the stream completes. WebSocket is the only approach that delivers individual frames in real-time through the Replit proxy.

**Server endpoint**: `wss://[host]/api/ws/stream?analysisId=UUID&token=CLERK_JWT`
- Token verified via `verifyToken(token, { secretKey })` from `@clerk/express`
- On successful auth, registers a `SseWriter` in `sseWriters` map (same interface)
- Sends `{"event":"connected"}` to confirm auth
- Heartbeat is NOT needed (WebSocket has its own keepalive via ping/pong)

**Message format** (server → client):
```json
{"event":"delta","text":"hello"}
{"event":"progress","step":"Berechne KPIs..."}
{"event":"chart","chart":{...}}
{"event":"sources","sources":["src1","src2"]}
{"event":"done"}
{"event":"error","message":"..."}
```

**Frontend hook**: `use-analysis-stream.ts` uses `WebSocket` directly.
- URL: `${proto}//${window.location.host}/api/ws/stream?analysisId=...&token=...`
- `window.location.host` is correct because Replit uses same-domain path-based routing
- Retry on abnormal close (not on 1000/4001/4003)
- Token obtained via `callbacksRef.current.getToken()` before connecting

**Backend location**: `artifacts/api-server/src/lib/wsHandler.ts`
- `attachWebSocketServer(httpServer)` called from `index.ts`
- `index.ts` uses `http.createServer(app)` + `httpServer.listen(port)` (not `app.listen()`)
- `ws` package version: installed as direct dependency

## Agent streaming internals

Use `client.messages.stream()` with `stream.on("text", delta => onTextDelta!(delta))` for token-by-token emission. Do NOT use `messages.create()`.

**How to apply:**
- In the main turn loop: `client.messages.stream({...})` + `stream.on("text", cb)` + `return stream.finalMessage()`
- `callWithRetry` is safe — 500/529 errors occur before first token
- The self-verification pass was removed — it caused 15-30s silence
- All 4 SSE callbacks must be passed to `processQuestion`: `onTextDelta`, `onProgress`, `onChart`, `onSourceSearched`

## createAnalysis route (template runs)
Must also pass all 4 callbacks in `setImmediate(() => processQuestion(..., { onTextDelta, onSourceSearched, onProgress, onChart, onDone }))`.

---
name: Milchvieh SSE auth & callback wiring
description: Two bugs that broke SSE streaming — Bearer token on SSE fetch, and createAnalysis missing SSE callbacks
---

## Rules

1. **SSE fetch must use Bearer token, not cookies.**  
   The app uses `setAuthTokenGetter(() => getToken())` (Clerk JWT), so `requireAuth` reads `Authorization: Bearer <token>`. An SSE `fetch()` with only `credentials:"include"` returns 401 silently. Always call `const token = await getToken()` then `headers["Authorization"] = \`Bearer ${token}\`` before opening the SSE stream.

2. **Every route that calls `processQuestion` in the background must wire SSE callbacks.**  
   The `createAnalysis` POST route and the `ask` POST route both fire `processQuestion` in `setImmediate`. Both must pass `{ onTextDelta, onSourceSearched, onDone }` closures that look up `sseWriters.get(id)`. Missing callbacks on `createAnalysis` meant initial questions never streamed — only follow-ups did.

**Why:** Bearer-only auth means cookies won't authenticate long-lived connections like SSE. The SSE writer registry is looked up lazily at callback-fire time, so there's no race condition as long as the callbacks are passed at all.

**How to apply:** Any new route that processes a question asynchronously must follow the same pattern as the `ask` route (lines ~322–336 in analyses.ts).

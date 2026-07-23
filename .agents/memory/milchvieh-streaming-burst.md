---
name: Milchvieh streaming burst fix
description: Why flushSync alone doesn't prevent burst rendering in SSE read loops, and the correct fix.
---

## Rule
In the SSE read loop (`use-analysis-stream.ts`), after each `delta` event add
`await new Promise<void>((r) => setTimeout(r, 0))` to yield to the browser task queue.
Do NOT rely on `flushSync` alone for anti-burst rendering.

## Why
`flushSync` forces React to commit DOM changes synchronously, but browsers only
PAINT between JS tasks. When multiple SSE events arrive in a single `reader.read()`
chunk, all events are processed in one synchronous for-loop without yielding — so
flushSync updates the DOM many times but the browser only paints once at the end
(burst appearance). The `setTimeout(0)` yield ensures each token gets its own
macrotask, giving the browser a paint opportunity between tokens.

## How to apply
- The fix is in the inner `for (const ev of events)` loop after `dispatch(ev.type, ev.data)`.
- Only yield after `delta` events (progress/chart events don't need per-event paints).
- Remove `flushSync` from `onDelta` — it's redundant once each delta is in its own macrotask.
- This also fixes invisible progress steps: without the yield, progress state updates
  are overwritten before the browser ever paints them.

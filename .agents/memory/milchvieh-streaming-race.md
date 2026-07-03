---
name: Milchvieh streaming race condition fix
description: React effect ordering bug where stopStream() aborted the controller startStream() just created
---

## Rule
Never call `startStream()` directly inside mutation callbacks or other synchronous event handlers in analyses.tsx. Always go through the `streamNonce` trigger pattern.

**Why:** React passive effects (useEffect) run after browser paint, AFTER all synchronous mutation callback code. So startStream() → abortRef.current = controller (sync), then effect's stopStream() runs (async post-paint) and aborts that same controller. The stream dies before reading a single chunk.

**How to apply:**
- `openSseStream()` sets `streamNonce(n => n+1)` — no direct startStream call
- Effect A (dep: activeAnalysisId): stopStream() + reset — cleans up old analysis
- Effect B (dep: streamNonce): startStream() — starts new stream, defined AFTER Effect A so it always runs after A in the same render cycle
- doStream() already aborts the previous controller at its own start, so switching analyses without a new question is also safe

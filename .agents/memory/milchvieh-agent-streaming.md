---
name: Milchvieh agent streaming
description: How the agent streams text to the client in real-time via SSE
---

## Rule
Use `client.messages.stream()` with `stream.on("text", delta => onTextDelta(delta))` for real-time token-by-token emission. Do NOT use `messages.create()` (non-streaming) — it delivers the entire response as one block.

**Why:** The earlier non-streaming workaround was introduced because `client.messages.stream()` threw errors for claude-sonnet-4-5 in this Replit env. That was a temporary Anthropic server-side issue (2025-06), now resolved. The non-streaming approach caused text to appear in one large block and added 15-30s of silent "Assistent arbeitet..." time due to a verification step.

**How to apply:**
- In the main turn loop: wrap `client.messages.stream({...})` + `stream.on("text", cb)` + `return stream.finalMessage()` inside `callWithRetry`
- `callWithRetry` is safe because 500/529 errors occur before the first token, so no duplicate delta emission on retry
- The self-verification pass (second API call after main response) was removed — it caused the long silence and the grounding enforcement already prevents hallucinated numbers
- Tool turns may also emit preamble text; this is acceptable and shows the user Claude is working

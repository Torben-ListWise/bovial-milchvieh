---
name: Milchvieh agent no-streaming
description: claude-sonnet-4-5 Anthropic streaming API is broken in this Replit environment; agent must use messages.create() only
---

## Rule
Never use `client.messages.stream()` or `client.beta.messages.stream()` in this project. Always use `client.messages.create()` (non-streaming).

**Why:** In this Replit environment, `claude-sonnet-4-5` streaming calls return HTTP 200 then emit `{"type":"error","message":"Internal server error"}` inside the SSE body. The Anthropic SDK surfaces this as an `_APIError` with `status=undefined`. Confirmed via binary testing: non-streaming `messages.create()` with the same payload (7+ tools) works perfectly every time.

**How to apply:**
- Main agent loop in `agent.ts`: uses `client.messages.create()` — do not switch back to streaming.
- Verifier call also uses `client.messages.create()` — same reason.
- `onTextDelta` is called once after all turns complete (with the full `finalText`), not word-by-word. SSE infrastructure still functions; text appears when the agent finishes rather than token-by-token. This is an acceptable UX tradeoff.
- Types: use `MessageParam`, `Tool`, `ToolUseBlock` from `@anthropic-ai/sdk/resources/messages` (not the Beta equivalents).
- System prompt: built as a plain string (no `cache_control` array blocks) via `buildSystemString()`.

---
name: Milchvieh processQuestion SSE callback contract
description: Every handler that calls processQuestion must forward the full callback set or the client hangs
---

## Rule
Every route handler that invokes `processQuestion(...)` (analysisService.ts) MUST forward the
complete SSE callback set to the buffered writer: `onTextDelta`, `onSourceSearched`,
`onProgress`, `onChart`, `onDone`. Missing any one silently breaks that surface for the client.

Handlers that must stay in sync: free-chat create + ask (routes/analyses.ts) and template run
(routes/templates.ts). Use analyses.ts as the reference wiring.

**Why:** The template-run handler once forwarded only `onTextDelta`/`onSourceSearched`/`onDone`
and omitted `onProgress`/`onChart`. The client's display keys off progress: it shows the
`AgentStepsTimeline` only when `completedSteps>0`, otherwise the static "Wird gestartet…" banner.
With no `progress` events reaching the SSE stream, template runs sat on "Wird gestartet…" and
"Berechne Ergebnis…" for the entire 20-40s run even though the agent was working — looked
completely frozen. Charts also silently never appeared.

**How to apply:** When adding a new entry point that runs the agent, copy the full callback
object from analyses.ts, not a subset. If the user reports a run "stuck on Wird gestartet" or
"no thinking steps", check that handler's processQuestion callbacks first.

## Related: streaming itself is fine
Anthropic `messages.stream()` + `stream.on("text")` streams incrementally in this Replit env
(empirically: a ~4.5k-char / 26s answer emitted ~54 deltas flowing every ~500ms). Short answers
may arrive in a single delta near the end simply because they finish fast. Do NOT switch back to
non-streaming `messages.create()` — see milchvieh-agent-streaming.md.

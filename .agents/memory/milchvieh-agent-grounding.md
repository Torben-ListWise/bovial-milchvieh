---
name: Milchvieh agent grounding enforcement
description: How the agent enforces the deterministic-number guarantee at runtime
---

## Rule
`runAgent()` tracks whether at least one compute tool was called (get_metric_stats, get_kpis, get_timeseries, get_group_aggregate, get_animal_ranking, detect_anomalies). If the model returns a final text response without having called any of these, the text is discarded and replaced with a safe German fallback message. get_schema and emit_chart alone do not satisfy the grounding requirement.

**Why:** The system prompt alone cannot prevent hallucination — the model can answer from parametric memory. The only reliable guard is runtime enforcement: if no compute evidence was gathered, no numeric answer can be trusted.

**How to apply:** The `toolWasCalled` flag in `runAgent()` is set to `true` only when a compute tool appears in a `tool_use` response block. The check fires after the loop exits with `stop_reason !== "tool_use"`.

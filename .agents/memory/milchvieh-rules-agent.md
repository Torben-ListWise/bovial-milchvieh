---
name: Milchvieh rules wired into agent
description: Customer-defined rules must be loaded and passed into every runAgent call
---

## Rule
In `processQuestion()`, load enabled rules for the analysis owner (`userId`) from `rulesTable` and pass them as `systemExtra` context to `runAgent()`. Rules are formatted as bullet lines so the agent can treat them as thresholds/hints during analysis.

**Why:** Rules created in the UI (Regeln page) are customer-defined thresholds (e.g. "SCC > 250k = warning"). The agent cannot reference these unless they are explicitly injected — they live in DB and the LLM has no access to the DB by itself.

**How to apply:** Load via `eq(rulesTable.userId, analysis.userId!)` + `eq(rulesTable.enabled, true)`. Format as: `Kundendefinierte Regeln:\n- {name}: {metric} {comparator} {threshold} {unit}`. Only append when rules exist (empty string → no systemExtra).

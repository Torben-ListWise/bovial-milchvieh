---
name: Milchvieh run_sql tool
description: Custom SQL tool added to agent for flexible data analysis
---

## Rule
The agent has a `run_sql` tool that executes arbitrary SELECT/WITH queries against `cow_events` and `data_rows`. The current `datasetId` is injected into every system prompt as `CURRENT_DATASET_ID` so the agent knows what to put in WHERE clauses.

**Why:** Fixed SQL tools (get_event_stats, get_repro_kpis etc.) cannot answer novel questions — e.g. "which cows had 3+ inseminations without a PREG", "time between FRESH and first BRED per animal", or any cross-column/cross-event analysis. run_sql gives the agent unlimited flexibility to write custom SQL.

**How to apply:**
- Tool validates SELECT/WITH as first keyword (after stripping SQL comments); rejects DDL/DML.
- Results are truncated to 500 rows in JS (no LIMIT injection to avoid breaking CTEs).
- `run_sql` is in `groundedTools` — it counts as real data access for the grounding guard.
- Progress label includes the agent-supplied `description` field.
- Tables: `cow_events` (animal_id, event_date, event_type, dim, remark, result, technician) and `data_rows` (record_date, data JSONB). Always filter by dataset_id.

---
name: Milchvieh architecture decisions
description: Key design and security decisions for the Milchvieh Datenanalyse-Assistent dairy app
---

**ACL ownership hardening:** `trySetObjectEntityAclPolicy` checks existing ACL owner before allowing reassignment — throws `ObjectAclConflictError` (403) if object already owned by a different user. Files route returns 502 (not silent continue) on any other ACL failure.

**Why:** Prevents an attacker who knows an object path from reassigning ownership to themselves (broken access control).

**LLM grounding:** Anthropic agent receives only deterministically-computed aggregates (KPIs, timeseries, anomaly stats) — never raw DB rows. The `detect_anomalies` tool returns bounded outlier lists (max 25 records with animalId/value/date) — this is intentional: farmers need actionable per-animal data, and the key is their own.

**Route contracts aligned to OpenAPI:**
- `POST /privacy/export` (not GET)
- `PATCH /files/:fileId/mapping` (not PUT)  
- `POST /datasets/:datasetId/analyses` returns `AnalysisDetail` with messages (not bare summary)
- `POST /analyses/:analysisId/messages` returns 200 (not 201)

**Operator role:** controlled by `OPERATOR_EMAILS` env var (comma-separated). Operator sees master data + activity log (aggregate metadata) but zero customer raw data.

**Required secrets/env:** `ANTHROPIC_API_KEY` (secret), `OPERATOR_EMAILS` (shared env). Clerk keys are auto-provisioned by Replit.

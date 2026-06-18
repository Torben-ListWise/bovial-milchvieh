---
name: Milchvieh cron endpoint security
description: CRON_SECRET must always be set; endpoint is fully disabled when unset
---

## Rule
`POST /api/admin/cron/run-reports` returns 503 (disabled) when `CRON_SECRET` env var is absent. When set, the caller must supply the matching value in `X-Cron-Secret` header (or `Authorization: Bearer <secret>`). No fallback to unauthenticated access.

**Why:** The endpoint triggers the Anthropic agent to generate reports for all datasets, which has real cost and side effects. Silently allowing unauthenticated access when the secret is unset is an abuse/cost risk the code reviewer flagged as blocking.

**How to apply:** Do not make CRON_SECRET optional. If deploying to an environment without an external cron, just leave it unset — the in-process `setInterval` scheduler still runs. The endpoint is only needed for external cron setups.

---
name: Milchvieh credit system
description: Credit-weighted quota replacing analysis-count quota; processQuestion return type change; credit_usage_log table
---

## Credit weights (quota.ts CREDIT_WEIGHTS)
- `simple` = 1 credit — default; any non-special tool or no tools called
- `complex` = 3 credits — get_timeseries, get_group_aggregate, detect_anomalies, run_sql, any unknown data tool
- `calculator` = 5 credits — calculate_investment, calculate_semen_planning, ask_farmer

Knowledge-only tools (search_knowledge, search_web, ask_farmer in isolation) yield 0 credits.

## Plan limits (PLAN_LIMITS in quota.ts)
- basis / free: 15 credits/month
- starter (Professional): 60
- pro (Premium): 200
- premium_max (Premium Max): Infinity (1500 soft-limit warning)
- beta: 200

## processQuestion return type
`processQuestion()` returns `ProcessQuestionResult` (not Message):
```ts
{ message: Message; complexity: AnalysisComplexity; credits: number; toolsCalled: string[]; inputTokens: number; outputTokens: number }
```
All callers (analyses.ts, ingest.ts) must destructure `.message` to get the Message.

## credit_usage_log table
Columns: id, analysis_id, user_id, dataset_id, complexity, credits, tools_called (JSONB), input_tokens, output_tokens, api_cost_millicents, plan, created_at.
API cost formula: `Math.round(inputTokens * 0.276 + outputTokens * 1.38)` millicents (Sonnet pricing at 0.92 EUR/USD).

## Operator dashboard
Route: `/app/credit-dashboard` → `CreditDashboardPage`.
API endpoint: `GET /api/admin/credit-usage` — paginated entries, aggregates by complexity, per-user monthly totals, outlier detection (cost > 2× avg for complexity class).

**Why:** Operators need to validate that 1/3/5 credit weighting reflects real API cost distribution before committing to the pricing model.

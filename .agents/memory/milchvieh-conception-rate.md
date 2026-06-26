---
name: Milchvieh conception rate linking
description: How to correctly calculate conception rate from German HMS event data
---

## Rule
Conception rate must be calculated by joining BRED events to subsequent PREG events for the same animal (`animal_id`) within a 120-day window. Never use `result = 'P'` on the BRED event itself.

**Why:** German HMS systems (e.g. RDV4M, HI-Tier exports) store pregnancy confirmation as a separate event with `event_type = 'PREG'` (TU positiv). The `result` field on the BRED event either stores an insemination number or is empty — it does NOT carry the pregnancy outcome. Using `result='P'` always yields 0% conception rate even when data is correct.

**How to apply:**
- `get_repro_kpis` — the CTE now uses a correlated EXISTS subquery: BRED.animal_id matches PREG.animal_id AND preg_date BETWEEN bred_date AND bred_date + 120 days.
- `get_event_stats(event_type='BRED', group_by='remark'|'technician')` — uses the same BRED→PREG join to include per-bull/per-technician conception rate.
- Denominator = all BRED events in the date range (not filtered by `result` eligibility codes).
- 120 days covers the standard 30–90 day post-insemination TU window plus buffer.
- OPEN events (TU negativ) are separate and do not factor into the conception calculation.

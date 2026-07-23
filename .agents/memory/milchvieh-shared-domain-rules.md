---
name: Milchvieh shared domain rules
description: sharedDomainRules.ts is the single source of truth for universal LLM prompt rules; every new prompt must import from it.
---

## Rule
`artifacts/api-server/src/lib/sharedDomainRules.ts` is the single source of truth for all universally-applicable LLM prompt blocks. Every new or modified LLM call must import and embed the relevant export(s).

**Why:** Patch R (Konzeptionsrate ≠ Pregnancy Rate) existed only in `SYSTEM_PROMPT_BASE` (agent.ts) but was missing from `EXTRACTION_SYSTEM_PROMPT` (reference-analyses.ts). This caused the BREDSUM\E card to incorrectly list "Konzeptionsraten" as a synonym for Pregnancy Rate.

## Exports
- `SHARED_TERMINOLOGY_RULES` — Konzeptionsrate vs. Pregnancy Rate vs. Brunsterkennungsrate distinction; BREDSUM\E canonical mapping. Use in any prompt that extracts, classifies, or generates terminology.
- `SHARED_DERIVATION_PROHIBITION` — No inventing data without source. Use in any prompt that extracts structured data from documents.
- `SHARED_EPISTEMIC_CAUTION` — Patch N; no over-confident claims. Use in any summaries or insight-generation prompt.
- `SHARED_DOMAIN_RULES` — Combination of all three. Use as default for general-purpose system prompts.

## Where each is applied (as of last update)
- `agent.ts` SYSTEM_PROMPT_BASE → SHARED_TERMINOLOGY_RULES + SHARED_EPISTEMIC_CAUTION
- `reference-analyses.ts` EXTRACTION_SYSTEM_PROMPT → SHARED_TERMINOLOGY_RULES + SHARED_DERIVATION_PROHIBITION
- `contextFacts.ts` EXTRACTION_PROMPT → SHARED_DERIVATION_PROHIBITION
- `chipScheduler.ts` both systemPrompts → SHARED_TERMINOLOGY_RULES
- `newsWeeklyBatch.ts` system: → SHARED_DOMAIN_RULES
- `insightsSummary.ts` system: → SHARED_EPISTEMIC_CAUTION

## How to apply
When adding a new `client.messages.create()` or `runAgent()` call, ask:
1. Does it generate domain text? → add SHARED_TERMINOLOGY_RULES
2. Does it extract structured data from documents? → add SHARED_DERIVATION_PROHIBITION
3. Does it summarise or opine? → add SHARED_EPISTEMIC_CAUTION
For runAgent() callers: no change needed — SYSTEM_PROMPT_BASE already includes them.

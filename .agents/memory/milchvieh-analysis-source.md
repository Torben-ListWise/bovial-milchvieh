---
name: Milchvieh analysis source enum
description: Valid values for analysesTable.source and how to handle unknown values at read time
---

## Rule
Valid source values are: `"user"`, `"auto"`, `"report"`, or `null`. Auto-ingestion (ingest.ts) must use `source: "auto"`. The value `"agent"` is not in the Zod/OpenAPI contract and will cause `ListAnalysesResponse.parse()` to throw a 500.

**Why:** The OpenAPI spec defines source as a nullable enum. Any value outside the enum causes Zod to throw at the route boundary, turning a simple list-analyses call into a 500 for all analyses after automatic ingestion.

**How to apply:**
- Write side: always use one of the three valid string values when inserting analyses.
- Read side: `serializeAnalysis` normalizes unknown DB values to `null` so legacy/bad rows never cause parse failures.

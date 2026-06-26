---
name: Milchvieh benchmark report
description: Architecture and key decisions for the Benchmark Report feature (3-case KPI annotation, benchmark_reference doc type, configurable factor)
---

# Benchmark Report Feature

## Schema
- `knowledge_documents.document_type TEXT` — value `'benchmark_reference'` marks the one active reference doc
- `master_data` row: category=`'Systemeinstellungen'`, key=`'benchmark_abweichungsfaktor'`, value=`'5'` (seeded in migration)
- `reports.sections` JSONB array includes `kpiRows: KpiRow[]` alongside `content` text (backwards-compat)

## 3-case logic (reports.ts POST handler)
- **Case 1**: farm value exists and ratio to benchmark ≤ factor → show as-is
- **Case 2**: farm value is null/missing AND benchmark reference exists → fill with benchmark value + label "Branchenrichtwert, Stand: [date]"
- **Case 3**: both values > 0 AND `max(val, ref) / min(val, ref) > factor` → keep farm value, add warning annotation
- Deviation ratio is `max/min` (both must be positive), not absolute difference

## Benchmark extraction
Claude `claude-3-5-haiku-20241022` extracts JSON values from benchmark doc text at report-generation time (not pre-indexed). Expects keys: `milk_yield_kg`, `fat_pct`, `protein_pct`, `scc`, `urea`, `feed_intake_kg`. Extraction failure is soft (logged, benchmarkValues stays empty → all Case 1).

## Upload flow
- Frontend: amber checkbox toggle in file upload area; sets `isBenchmarkRef` on `UploadItem`
- `uploadFile` passes `documentType: "benchmark_reference"` in POST body to upload-url
- `POST /knowledge/upload-url`: if `documentType === 'benchmark_reference'`, existing benchmark doc is deleted (chunks + object storage + DB row) before the new insert
- Only one active benchmark_reference at a time guaranteed at upload time

## UI
- Badge `Star + "Referenz-Benchmark"` (amber) shown in doc list for `documentType === 'benchmark_reference'`
- `BenchmarkFactorSection` component at bottom of operator knowledge page: inline-edit of benchmark factor via PATCH `/api/masterdata/:id`

**Why:** Factor stored in DB not code so operators can tune sensitivity without a deployment.

---
name: Milchvieh project architecture
description: Key architecture decisions and non-obvious constraints for the Milchvieh Datenanalyse-Assistent project
---

## Core constraints
- LLM only narrates; all numbers computed deterministically in code (compute layer)
- Send only aggregates/schema to AI, never raw rows
- Own Anthropic key via ANTHROPIC_API_KEY secret (direct SDK, not Replit AI integration)
- German UI throughout; German number formats parsed in canonical.ts (parseGermanNumber)
- analysesTable has NO `status` column — use `source` text field instead
- messagesTable has NO `source` column

## Header detection
- detectHeaderRow() in ingest.ts scans first 10 rows, picks row with most canonical-field matches
- Both analyzeFile() and materializeRows() use this — handles exports with metadata rows before headers

## Scheduler
- In-process setInterval (hourly) for always-on deployments
- External cron path: POST /api/admin/cron/run-reports with X-Cron-Secret header (CRON_SECRET env var)
- runScheduledReports(force=true) shared by both paths

## DSGVO export
- Includes dataRows (capped at 10k), signed 1-hour download URLs for original files
- POST /privacy/export (not GET) per route contract

## Object storage
- ACL ownership enforced via ObjectAclConflictError
- masterDataTable: category='reference_range', key=<metric>_min or <metric>_max

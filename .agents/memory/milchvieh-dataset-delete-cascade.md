---
name: Milchvieh dataset deletion cascade
description: All tables that must be cleaned up when a dataset is deleted
---

## Rule
`DELETE /datasets/:datasetId` must remove in this order: messages (for analyses linked to dataset) → analyses → reports → data_rows → source_files → warnings → activity_log entries → dataset row. There are no FK cascades in the schema.

**Why:** Without explicit deletion, orphaned analyses/messages/reports persist after dataset deletion. This breaks data lifecycle expectations and creates DSGVO compliance issues (user believes their farm data is gone but AI conversation history remains).

**How to apply:** Always fetch `analysesTable` rows first to get IDs, then delete `messagesTable` where `analysisId IN (ids)`, then proceed with the remaining tables in order. Use `inArray` from drizzle-orm for the messages step.

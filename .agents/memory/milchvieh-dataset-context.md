---
name: Milchvieh dataset context persistence
description: Why and how datasetId must be preserved in sidebar navigation for customer pages
---

## Rule
All customer-facing sidebar nav links that are dataset-scoped must append `?datasetId=<id>` when a dataset is currently selected. The "Betriebe" (datasets list) link is exempt — it intentionally drops context so the user can switch datasets.

**Why:** Customer pages (overview, upload, analyses, warnings, reports, rules) all read `datasetId` from the URL query string. Without it they show "Bitte wählen Sie einen Betrieb aus der Betriebsliste" and are unusable. Before this fix, clicking any sidebar link lost the datasetId.

**How to apply:** In `layout.tsx`, each nav item has a `preserveDataset: boolean` flag. When true, the link href is built as `${item.href}${datasetQuery}` where `datasetQuery = datasetId ? ?datasetId=${datasetId} : ""`. Read `datasetId` from `window.location.search` at render time.

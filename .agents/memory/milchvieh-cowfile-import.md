---
name: DairyComp COWFILE1.DAT import
description: Binary parser + ingestion path for DairyComp-305 herd files in the Milchvieh app
---

- Parser: `parseCowfile.ts` locates all structures dynamically (item dictionary anchored on "BDAT\x00", event-name table anchored BORN→FRESH, cow region scanned in 0x1000 steps). Never hardcode absolute offsets — they vary per farm/version.
- Dictionary entry validation: names may start with digits (`305ME`), widths can be 0 or up to ~230 (`DUDRY`). Overly strict validation silently truncates the dictionary because the walk stops at the first invalid entry.
- Event dates are u16 days since 1960-01-01. Cow records are 0x3000 bytes; events at +0x800, lactations at +0x2800.
- Milk totals per lactation could NOT be reliably decoded (bimodal/implausible) — only lactation number + dates are imported. Master items TOTM/305ME exist for future decoding.
- Registration field (REG1) contains binary garbage on some farms — only kept if it passes a printable-ASCII check.
- Ingestion: `.dat` extension → `ingestCowfileFile()` in ingest.ts (streams to tmp file, never loads 100 MB into RAM). File kind stored as `herd_export`; summary in previewRows[0].cowfileSummary. Fails loudly: on insert error, all data_rows + cow_events for the fileId are deleted before rethrow.
- **Dataset/file deletion must also delete cow_events** (no FK cascades); fixed in datasets.ts + files.ts delete routes. Any new per-dataset table needs the same treatment.

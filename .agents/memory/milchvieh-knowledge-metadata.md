---
name: Milchvieh knowledge metadata
description: Bibliographic metadata system for Wissensbibliothek — extraction flow, DB columns, state machine, search boosting pattern
---

## Extraction state machine

`meta_pending` JSONB on `knowledge_documents` acts as a state field:

| `meta_pending` | `tier_stufe` | Meaning |
|---|---|---|
| `null` | `null` | Not yet extracted — batch job hasn't run |
| `{ _extractionStatus: "pending_review", ... }` | `null` | Claude extracted useful fields; awaiting admin confirmation |
| `{ _extractionStatus: "incomplete" }` | `null` | Claude ran but couldn't determine key fields — manual input required |
| `null` | set | Confirmed — final metadata is in the table columns |

**Why:** Distinguishing "pending review" from "truly incomplete extraction" prevents the admin UI from conflating two different action states.

## Topic persistence rule

`confirmDocumentMetadata()` MUST always DELETE all existing topics, then INSERT zero-or-more. Never skip the delete on empty input — an empty topics array is a valid user choice that clears stale topic tags. Leaving the length > 0 guard causes stale categorization to affect search boosting and UI display.

## Topic boosting in search_knowledge

`detectQueryTopic(query)` returns one of 10 fixed topics via keyword regex. The search handler fetches 2×topK candidates, boosts +0.05 similarity for docs whose `knowledge_document_topics` include the detected topic, re-sorts, then trims to topK. Threshold stays 0.55.

## meta_url field

`meta_url TEXT` is the DOI or canonical publication URL extracted from the document text — distinct from `source_url` (which is the upload/scrape origin URL). Both admin confirmation form and PATCH route accept `metaUrl`.

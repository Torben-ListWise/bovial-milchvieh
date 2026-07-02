---
name: Milchvieh orval codegen vs manual schemas
description: orval --clean wipes manual files in api-zod and api-client-react; farm-notes is the known case
---

## Rule
Never run `orval` codegen without restoring the manually-maintained files afterward.

orval is configured with `clean: true` (see `lib/api-spec/orval.config.ts`), which **deletes** everything in the generated output directories before regenerating. Any manually written code placed in those directories will be lost.

**Why:** The farm-notes endpoints (`GET/POST /farm-notes`, `PATCH/DELETE /farm-notes/:noteId`) are not declared in the OpenAPI spec (`lib/api-spec/openapi.yaml`), so orval never generates hooks or Zod schemas for them. They were hand-written and silently lost on the next codegen run.

## Manual files that must survive a codegen run
- `lib/api-client-react/src/farm-notes.ts` — React Query hooks (useListFarmNotes, useCreateFarmNote, useUpdateFarmNote, useDeleteFarmNote, getListFarmNotesQueryKey, FarmNote type). Exported from `lib/api-client-react/src/index.ts`.
- `lib/api-zod/src/index.ts` — re-exports `./generated/api` PLUS manually written Zod schemas: CreateFarmNoteBody, UpdateFarmNoteParams, UpdateFarmNoteBody, DeleteFarmNoteParams.

## How to apply
After any `orval` codegen run, check that:
1. `lib/api-client-react/src/farm-notes.ts` still exists and is exported from `index.ts`
2. `lib/api-zod/src/index.ts` still contains the manual Zod schemas below the `export * from "./generated/api"` line

**Permanent fix (follow-up task #313):** add farm-notes endpoints to `lib/api-spec/openapi.yaml` so orval generates them automatically and the manual shims are no longer needed.

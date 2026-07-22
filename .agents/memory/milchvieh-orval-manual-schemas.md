---
name: Milchvieh orval codegen vs manual schemas
description: orval --clean wipes manual files in api-zod and api-client-react; farm-notes is the known case
---

## Rule
Never run `orval` codegen without restoring the manually-maintained files afterward.

orval is configured with `clean: true` (see `lib/api-spec/orval.config.ts`), which **deletes** everything in the generated output directories before regenerating. Any manually written code placed in those directories will be lost.

**Why:** The farm-notes endpoints (`GET/POST /farm-notes`, `PATCH/DELETE /farm-notes/:noteId`) are not declared in the OpenAPI spec (`lib/api-spec/openapi.yaml`), so orval never generates hooks or Zod schemas for them. They were hand-written and silently lost on the next codegen run.

## Manual fields added to generated schemas in `lib/api-zod/src/generated/api.ts`
These fields are not in the OpenAPI spec and will be lost on the next codegen run:

- `CreateAnalysisBody` — `imageObjectPath?: string`, `depthLevel?: string`, `contextFileIds?: string[]`
- `AskQuestionBody` — `imageObjectPath?: string` ← **missing this caused images on follow-up messages to be silently dropped by Zod**
- `GetAnalysisResponse` → inner messages `zod.object(...)` needs `.passthrough()` so `widgetSpec`/`backQuestions` survive

**Why `AskQuestionBody` matters:** Zod strips unknown keys by default. If `imageObjectPath` is not declared in the schema, the server receives `undefined` and never downloads/sends the image to the agent. The frontend correctly sends the field; the server silently discards it.

## Manual files that must survive a codegen run
- `lib/api-client-react/src/farm-notes.ts` — React Query hooks (useListFarmNotes, useCreateFarmNote, useUpdateFarmNote, useDeleteFarmNote, getListFarmNotesQueryKey, FarmNote type). Exported from `lib/api-client-react/src/index.ts`.
- `lib/api-zod/src/index.ts` — re-exports `./generated/api` PLUS manually written Zod schemas: CreateFarmNoteBody, UpdateFarmNoteParams, UpdateFarmNoteBody, DeleteFarmNoteParams.

## How to apply
After any `orval` codegen run, check that:
1. `lib/api-client-react/src/farm-notes.ts` still exists and is exported from `index.ts`
2. `lib/api-zod/src/index.ts` still contains the manual Zod schemas below the `export * from "./generated/api"` line
3. `lib/api-zod/src/generated/api.ts`: restore all manual fields listed above (search for "added manually" comments)

**Permanent fix (follow-up task #313):** add farm-notes endpoints to `lib/api-spec/openapi.yaml` so orval generates them automatically and the manual shims are no longer needed.

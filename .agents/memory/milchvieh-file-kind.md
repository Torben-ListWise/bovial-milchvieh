---
name: Milchvieh file kind normalization
description: DB may contain kind values not in the Zod union (e.g. "spreadsheet"); must normalize at read time in serializers.ts
---

## Rule
Always run the stored `kind` value through `normalizeFileKind()` in `serializeFile()` before passing it to Zod. Never pass a raw DB string to `ListFilesResponse.parse()` without normalization.

**Why:** Old or externally-written records in `source_files` may have `kind="spreadsheet"` (or other legacy values). The Zod union only accepts: `excel | csv | herd_export | pdf | ppt | other | livestock_events | null`. Unknown values cause a Zod 500 on `GET /api/datasets/:id/files`, making the entire file list disappear for the user.

**How to apply:**
- `normalizeFileKind(kind)` in `serializers.ts` maps known aliases (`spreadsheet` → `excel`, etc.) and returns `null` for anything truly unknown.
- `null` falls through to `deriveFileKind(f.name)` which infers kind from the file extension — so files are never lost.
- If new kind values are added to the DB schema, add them to `VALID_FILE_KINDS` set and the Zod union in `lib/api-zod/src/generated/api.ts`.

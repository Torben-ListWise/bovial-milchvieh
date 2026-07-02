export * from "./generated/api";

import * as zod from "zod";

export const CreateFarmNoteBody = zod.object({
  content: zod.string(),
  enabled: zod.boolean().optional(),
});

export const UpdateFarmNoteParams = zod.object({
  noteId: zod.string(),
});

export const UpdateFarmNoteBody = zod.object({
  content: zod.string().optional(),
  enabled: zod.boolean().optional(),
});

export const DeleteFarmNoteParams = zod.object({
  noteId: zod.string(),
});

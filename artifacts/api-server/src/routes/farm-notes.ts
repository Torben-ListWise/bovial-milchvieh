import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, farmNotesTable, type FarmNote } from "@workspace/db";
import {
  CreateFarmNoteBody,
  UpdateFarmNoteParams,
  UpdateFarmNoteBody,
  DeleteFarmNoteParams,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function serializeNote(n: FarmNote) {
  return {
    id: n.id,
    content: n.content,
    enabled: n.enabled,
    createdAt: n.createdAt,
  };
}

router.get("/farm-notes", requireAuth, async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(farmNotesTable)
    .where(eq(farmNotesTable.userId, req.userId!))
    .orderBy(desc(farmNotesTable.createdAt));
  res.json(rows.map(serializeNote));
});

router.post("/farm-notes", requireAuth, async (req: Request, res: Response) => {
  const parsed = CreateFarmNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  if (parsed.data.content.length > 2000) {
    res.status(400).json({ error: "Hinweis zu lang (max. 2000 Zeichen)" });
    return;
  }
  const [created] = await db
    .insert(farmNotesTable)
    .values({
      userId: req.userId!,
      content: parsed.data.content,
      enabled: parsed.data.enabled ?? true,
    })
    .returning();
  res.status(201).json(serializeNote(created));
});

router.patch("/farm-notes/:noteId", requireAuth, async (req: Request, res: Response) => {
  const { noteId } = UpdateFarmNoteParams.parse(req.params);
  const parsed = UpdateFarmNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  const [existing] = await db
    .select()
    .from(farmNotesTable)
    .where(and(eq(farmNotesTable.id, noteId), eq(farmNotesTable.userId, req.userId!)));
  if (!existing) {
    res.status(404).json({ error: "Hinweis nicht gefunden" });
    return;
  }
  const d = parsed.data;
  const [updated] = await db
    .update(farmNotesTable)
    .set({
      ...(d.content !== undefined ? { content: d.content } : {}),
      ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
    })
    .where(eq(farmNotesTable.id, noteId))
    .returning();
  res.json(serializeNote(updated));
});

router.delete("/farm-notes/:noteId", requireAuth, async (req: Request, res: Response) => {
  const { noteId } = DeleteFarmNoteParams.parse(req.params);
  const [existing] = await db
    .select()
    .from(farmNotesTable)
    .where(and(eq(farmNotesTable.id, noteId), eq(farmNotesTable.userId, req.userId!)));
  if (!existing) {
    res.status(404).json({ error: "Hinweis nicht gefunden" });
    return;
  }
  await db.delete(farmNotesTable).where(eq(farmNotesTable.id, noteId));
  res.status(204).end();
});

export default router;

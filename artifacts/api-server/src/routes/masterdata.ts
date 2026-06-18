import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db, masterDataTable, type MasterDataEntry } from "@workspace/db";
import {
  ListMasterDataResponse,
  CreateMasterDataBody,
  UpdateMasterDataParams,
  UpdateMasterDataBody,
  UpdateMasterDataResponse,
  DeleteMasterDataParams,
} from "@workspace/api-zod";
import { requireAuth, requireOperator } from "../lib/auth";

const router: IRouter = Router();

function serialize(e: MasterDataEntry) {
  return {
    id: e.id,
    category: e.category,
    key: e.key,
    value: e.value,
    unit: e.unit ?? null,
    notes: e.notes ?? null,
    createdAt: e.createdAt,
  };
}

// Readable by any authenticated user (trusted reference data); writes operator-only.
router.get("/masterdata", requireAuth, async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(masterDataTable)
    .orderBy(desc(masterDataTable.createdAt));
  res.json(ListMasterDataResponse.parse(rows.map(serialize)));
});

router.post(
  "/masterdata",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const parsed = CreateMasterDataBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ungültige Eingabe" });
      return;
    }
    const [created] = await db
      .insert(masterDataTable)
      .values({
        category: parsed.data.category,
        key: parsed.data.key,
        value: parsed.data.value,
        unit: parsed.data.unit,
        notes: parsed.data.notes,
      })
      .returning();
    res.status(201).json(serialize(created));
  },
);

router.patch(
  "/masterdata/:entryId",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { entryId } = UpdateMasterDataParams.parse(req.params);
    const parsed = UpdateMasterDataBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ungültige Eingabe" });
      return;
    }
    const d = parsed.data;
    const [updated] = await db
      .update(masterDataTable)
      .set({
        ...(d.category !== undefined ? { category: d.category } : {}),
        ...(d.key !== undefined ? { key: d.key } : {}),
        ...(d.value !== undefined ? { value: d.value } : {}),
        ...(d.unit !== undefined ? { unit: d.unit } : {}),
        ...(d.notes !== undefined ? { notes: d.notes } : {}),
      })
      .where(eq(masterDataTable.id, entryId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Eintrag nicht gefunden" });
      return;
    }
    res.json(UpdateMasterDataResponse.parse(serialize(updated)));
  },
);

router.delete(
  "/masterdata/:entryId",
  requireAuth,
  requireOperator,
  async (req: Request, res: Response) => {
    const { entryId } = DeleteMasterDataParams.parse(req.params);
    const result = await db
      .delete(masterDataTable)
      .where(eq(masterDataTable.id, entryId))
      .returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Eintrag nicht gefunden" });
      return;
    }
    res.status(204).end();
  },
);

export default router;

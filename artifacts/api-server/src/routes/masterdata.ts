import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, masterDataTable, datasetsTable, type MasterDataEntry } from "@workspace/db";
import {
  ListMasterDataResponse,
  CreateMasterDataBody,
  UpdateMasterDataParams,
  UpdateMasterDataBody,
  UpdateMasterDataResponse,
  DeleteMasterDataParams,
} from "@workspace/api-zod";
import { requireAuth, requireOperator } from "../lib/auth";
import { normalizeSector, serializeMasterData } from "../lib/serializers";

const router: IRouter = Router();

// Readable by any authenticated user (trusted reference data); writes operator-only.
// Optional ?datasetId query param: filter to entries matching that dataset's sector.
router.get("/masterdata", requireAuth, async (req: Request, res: Response) => {
  const datasetId = req.query.datasetId as string | undefined;

  if (datasetId) {
    // Load dataset to determine sector
    const [d] = await db
      .select({ sector: datasetsTable.sector })
      .from(datasetsTable)
      .where(eq(datasetsTable.id, datasetId));

    if (d) {
      const sector = normalizeSector((d as any).sector);
      // Map sector key to the sector tag stored in master_data
      const sectorTag = sector === "dairy" ? "dairy" : sector === "biogas" ? "biogas" : "arable";
      const rows = await db
        .select()
        .from(masterDataTable)
        .where(
          or(
            isNull(masterDataTable.sector),
            eq(masterDataTable.sector, sectorTag),
          ),
        )
        .orderBy(desc(masterDataTable.createdAt));
      res.json(ListMasterDataResponse.parse(rows.map(serializeMasterData)));
      return;
    }
  }

  const rows = await db
    .select()
    .from(masterDataTable)
    .orderBy(desc(masterDataTable.createdAt));
  res.json(ListMasterDataResponse.parse(rows.map(serializeMasterData)));
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
        sector: (parsed.data as any).sector ?? null,
      })
      .returning();
    res.status(201).json(serializeMasterData(created));
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
        ...((d as any).sector !== undefined ? { sector: (d as any).sector } : {}),
      })
      .where(eq(masterDataTable.id, entryId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Eintrag nicht gefunden" });
      return;
    }
    res.json(UpdateMasterDataResponse.parse(serializeMasterData(updated)));
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

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  datasetsTable,
  sourceFilesTable,
  dataRowsTable,
  warningsTable,
  type Dataset,
} from "@workspace/db";
import {
  ListDatasetsResponse,
  CreateDatasetBody,
  GetDatasetParams,
  GetDatasetResponse,
  UpdateDatasetParams,
  UpdateDatasetBody,
  UpdateDatasetResponse,
  DeleteDatasetParams,
  GetDatasetOverviewParams,
  GetDatasetOverviewResponse,
  GetQuestionSuggestionsParams,
  GetQuestionSuggestionsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { serializeDataset, mapDatasetStatus } from "../lib/serializers";
import { computeDashboard, getDatasetSchema } from "../lib/compute";

const router: IRouter = Router();

async function counts(datasetId: string) {
  const [f] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(sourceFilesTable)
    .where(eq(sourceFilesTable.datasetId, datasetId));
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(dataRowsTable)
    .where(eq(dataRowsTable.datasetId, datasetId));
  return { fileCount: f?.c ?? 0, rowCount: r?.c ?? 0 };
}

async function ownDataset(
  datasetId: string,
  userId: string,
): Promise<Dataset | null> {
  const [d] = await db
    .select()
    .from(datasetsTable)
    .where(and(eq(datasetsTable.id, datasetId), eq(datasetsTable.userId, userId)));
  return d ?? null;
}

router.get("/datasets", requireAuth, async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(datasetsTable)
    .where(eq(datasetsTable.userId, req.userId!))
    .orderBy(desc(datasetsTable.createdAt));
  const out = [];
  for (const d of rows) {
    const c = await counts(d.id);
    out.push(serializeDataset(d, c.fileCount, c.rowCount));
  }
  res.json(ListDatasetsResponse.parse(out));
});

router.post("/datasets", requireAuth, async (req: Request, res: Response) => {
  const parsed = CreateDatasetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  const [created] = await db
    .insert(datasetsTable)
    .values({
      userId: req.userId!,
      name: parsed.data.name,
      description: parsed.data.description,
      status: "empty",
    })
    .returning();
  res.status(201).json(serializeDataset(created, 0, 0));
});

router.get("/datasets/:datasetId", requireAuth, async (req: Request, res: Response) => {
  const { datasetId } = GetDatasetParams.parse(req.params);
  const d = await ownDataset(datasetId, req.userId!);
  if (!d) {
    res.status(404).json({ error: "Datensatz nicht gefunden" });
    return;
  }
  const c = await counts(d.id);
  res.json(GetDatasetResponse.parse(serializeDataset(d, c.fileCount, c.rowCount)));
});

router.patch("/datasets/:datasetId", requireAuth, async (req: Request, res: Response) => {
  const { datasetId } = UpdateDatasetParams.parse(req.params);
  const parsed = UpdateDatasetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  const d = await ownDataset(datasetId, req.userId!);
  if (!d) {
    res.status(404).json({ error: "Datensatz nicht gefunden" });
    return;
  }
  const [updated] = await db
    .update(datasetsTable)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(datasetsTable.id, datasetId))
    .returning();
  const c = await counts(datasetId);
  res.json(UpdateDatasetResponse.parse(serializeDataset(updated, c.fileCount, c.rowCount)));
});

router.delete("/datasets/:datasetId", requireAuth, async (req: Request, res: Response) => {
  const { datasetId } = DeleteDatasetParams.parse(req.params);
  const d = await ownDataset(datasetId, req.userId!);
  if (!d) {
    res.status(404).json({ error: "Datensatz nicht gefunden" });
    return;
  }
  await db.delete(dataRowsTable).where(eq(dataRowsTable.datasetId, datasetId));
  await db.delete(sourceFilesTable).where(eq(sourceFilesTable.datasetId, datasetId));
  await db.delete(warningsTable).where(eq(warningsTable.datasetId, datasetId));
  await db.delete(datasetsTable).where(eq(datasetsTable.id, datasetId));
  res.status(204).end();
});

router.get(
  "/datasets/:datasetId/overview",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = GetDatasetOverviewParams.parse(req.params);
    const d = await ownDataset(datasetId, req.userId!);
    if (!d) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }
    const { kpis, charts } = await computeDashboard(datasetId);
    const [w] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(warningsTable)
      .where(and(eq(warningsTable.datasetId, datasetId), eq(warningsTable.status, "open")));
    res.json(
      GetDatasetOverviewResponse.parse({
        datasetId,
        status: mapDatasetStatus(d.status),
        kpis,
        charts,
        warningCount: w?.c ?? 0,
        lastUpdated: d.updatedAt ?? null,
      }),
    );
  },
);

const SUGGESTION_DEFS: {
  needs: string[];
  question: string;
  category: string;
}[] = [
  {
    needs: ["milk_yield_kg"],
    question: "Wie hat sich die Milchleistung in den letzten Monaten entwickelt?",
    category: "Milchleistung",
  },
  {
    needs: ["scc"],
    question: "Gibt es Tiere mit auffällig hoher Zellzahl?",
    category: "Eutergesundheit",
  },
  {
    needs: ["fat_pct", "protein_pct"],
    question: "Wie entwickelt sich das Fett-Eiweiß-Verhältnis im Zeitverlauf?",
    category: "Inhaltsstoffe",
  },
  {
    needs: ["urea"],
    question: "Was sagt der Harnstoffgehalt über die Fütterung aus?",
    category: "Fütterung",
  },
  {
    needs: ["milk_yield_kg", "lactation_number"],
    question: "Wie unterscheidet sich die Milchleistung nach Laktationsnummer?",
    category: "Milchleistung",
  },
  {
    needs: ["milk_yield_kg", "animal_id"],
    question: "Welche Tiere haben die höchste und niedrigste Milchleistung?",
    category: "Milchleistung",
  },
];

router.get(
  "/datasets/:datasetId/suggestions",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = GetQuestionSuggestionsParams.parse(req.params);
    const d = await ownDataset(datasetId, req.userId!);
    if (!d) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }
    const schema = await getDatasetSchema(datasetId);
    const present = new Set(schema.fields.map((f) => f.key));
    const out = SUGGESTION_DEFS.filter((s) => s.needs.every((n) => present.has(n)))
      .slice(0, 6)
      .map((s, i) => ({ id: `sug_${i}`, question: s.question, category: s.category }));
    res.json(GetQuestionSuggestionsResponse.parse(out));
  },
);

export default router;

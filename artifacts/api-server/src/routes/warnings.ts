import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  datasetsTable,
  warningsTable,
  type Warning,
} from "@workspace/db";
import {
  ListWarningsParams,
  ListWarningsResponse,
  UpdateWarningParams,
  UpdateWarningBody,
  UpdateWarningResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function serializeWarning(w: Warning) {
  return {
    id: w.id,
    datasetId: w.datasetId,
    title: w.title,
    detail: w.detail ?? null,
    metric: w.metric ?? null,
    value: w.value ?? null,
    severity: w.severity as "info" | "warning" | "critical",
    status: w.status as "open" | "acknowledged" | "dismissed",
    ruleId: w.ruleId ?? null,
    createdAt: w.createdAt,
  };
}

router.get(
  "/datasets/:datasetId/warnings",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = ListWarningsParams.parse(req.params);
    const [d] = await db
      .select({ id: datasetsTable.id })
      .from(datasetsTable)
      .where(and(eq(datasetsTable.id, datasetId), eq(datasetsTable.userId, req.userId!)));
    if (!d) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }
    const rows = await db
      .select()
      .from(warningsTable)
      .where(eq(warningsTable.datasetId, datasetId))
      .orderBy(desc(warningsTable.createdAt));
    res.json(ListWarningsResponse.parse(rows.map(serializeWarning)));
  },
);

router.patch("/warnings/:warningId", requireAuth, async (req: Request, res: Response) => {
  const { warningId } = UpdateWarningParams.parse(req.params);
  const parsed = UpdateWarningBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  const [existing] = await db
    .select()
    .from(warningsTable)
    .where(and(eq(warningsTable.id, warningId), eq(warningsTable.userId, req.userId!)));
  if (!existing) {
    res.status(404).json({ error: "Warnung nicht gefunden" });
    return;
  }
  const [updated] = await db
    .update(warningsTable)
    .set({ status: parsed.data.status })
    .where(eq(warningsTable.id, warningId))
    .returning();
  res.json(UpdateWarningResponse.parse(serializeWarning(updated)));
});

export default router;

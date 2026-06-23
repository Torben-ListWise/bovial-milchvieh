import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, rulesTable, type Rule } from "@workspace/db";
import {
  ListRulesResponse,
  CreateRuleBody,
  UpdateRuleParams,
  UpdateRuleBody,
  UpdateRuleResponse,
  DeleteRuleParams,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function serializeRule(r: Rule) {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    metric: r.metric,
    comparator: (r.comparator as "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | null) ?? null,
    threshold: r.threshold ?? null,
    unit: r.unit ?? null,
    severity: (r.severity as "info" | "warning" | "critical" | null) ?? "warning",
    enabled: r.enabled,
    createdAt: r.createdAt,
  };
}

router.get("/rules", requireAuth, async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(rulesTable)
    .where(eq(rulesTable.userId, req.userId!))
    .orderBy(desc(rulesTable.createdAt));
  res.json(ListRulesResponse.parse(rows.map(serializeRule)));
});

router.post("/rules", requireAuth, async (req: Request, res: Response) => {
  const parsed = CreateRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  if (parsed.data.name.length > 200) {
    res.status(400).json({ error: "Name zu lang (max. 200 Zeichen)" });
    return;
  }
  if (parsed.data.description && parsed.data.description.length > 1_000) {
    res.status(400).json({ error: "Beschreibung zu lang (max. 1000 Zeichen)" });
    return;
  }
  const [created] = await db
    .insert(rulesTable)
    .values({
      userId: req.userId!,
      name: parsed.data.name,
      description: parsed.data.description,
      metric: parsed.data.metric,
      comparator: parsed.data.comparator,
      threshold: parsed.data.threshold,
      unit: parsed.data.unit,
      severity: parsed.data.severity ?? "warning",
      enabled: parsed.data.enabled ?? true,
    })
    .returning();
  res.status(201).json(serializeRule(created));
});

router.patch("/rules/:ruleId", requireAuth, async (req: Request, res: Response) => {
  const { ruleId } = UpdateRuleParams.parse(req.params);
  const parsed = UpdateRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  if (parsed.data.name && parsed.data.name.length > 200) {
    res.status(400).json({ error: "Name zu lang (max. 200 Zeichen)" });
    return;
  }
  if (parsed.data.description && parsed.data.description.length > 1_000) {
    res.status(400).json({ error: "Beschreibung zu lang (max. 1000 Zeichen)" });
    return;
  }
  const [existing] = await db
    .select()
    .from(rulesTable)
    .where(and(eq(rulesTable.id, ruleId), eq(rulesTable.userId, req.userId!)));
  if (!existing) {
    res.status(404).json({ error: "Regel nicht gefunden" });
    return;
  }
  const d = parsed.data;
  const [updated] = await db
    .update(rulesTable)
    .set({
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.metric !== undefined ? { metric: d.metric } : {}),
      ...(d.comparator !== undefined ? { comparator: d.comparator } : {}),
      ...(d.threshold !== undefined ? { threshold: d.threshold } : {}),
      ...(d.unit !== undefined ? { unit: d.unit } : {}),
      ...(d.severity !== undefined ? { severity: d.severity } : {}),
      ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
    })
    .where(eq(rulesTable.id, ruleId))
    .returning();
  res.json(UpdateRuleResponse.parse(serializeRule(updated)));
});

router.delete("/rules/:ruleId", requireAuth, async (req: Request, res: Response) => {
  const { ruleId } = DeleteRuleParams.parse(req.params);
  const [existing] = await db
    .select()
    .from(rulesTable)
    .where(and(eq(rulesTable.id, ruleId), eq(rulesTable.userId, req.userId!)));
  if (!existing) {
    res.status(404).json({ error: "Regel nicht gefunden" });
    return;
  }
  await db.delete(rulesTable).where(eq(rulesTable.id, ruleId));
  res.status(204).end();
});

export default router;

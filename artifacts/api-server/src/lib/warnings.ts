import { and, eq } from "drizzle-orm";
import {
  db,
  rulesTable,
  warningsTable,
  type Rule,
} from "@workspace/db";
import { computeMetricStats, detectAnomalies, getDatasetSchema } from "./compute";
import { CANONICAL_FIELD_MAP } from "./canonical";

function compare(value: number, comparator: string | null, threshold: number): boolean {
  switch (comparator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
    case "neq":
      return value !== threshold;
    default:
      return false;
  }
}

// Re-evaluate all rules + anomalies for a dataset and (re)create open warnings.
export async function evaluateWarnings(
  datasetId: string,
  userId: string,
): Promise<number> {
  // Clear previous auto-generated open warnings for this dataset.
  await db
    .delete(warningsTable)
    .where(
      and(
        eq(warningsTable.datasetId, datasetId),
        eq(warningsTable.status, "open"),
      ),
    );

  const schema = await getDatasetSchema(datasetId);
  const presentMetrics = new Set(schema.fields.map((f) => f.key));
  if (schema.totalRows === 0) return 0;

  const rules: Rule[] = await db
    .select()
    .from(rulesTable)
    .where(and(eq(rulesTable.userId, userId), eq(rulesTable.enabled, true)));

  const newWarnings: {
    datasetId: string;
    userId: string;
    title: string;
    detail: string;
    metric: string;
    value: number;
    severity: string;
    ruleId: string | null;
  }[] = [];

  for (const rule of rules) {
    if (!presentMetrics.has(rule.metric)) continue;
    if (rule.threshold == null || !rule.comparator) continue;
    const stats = await computeMetricStats(datasetId, rule.metric);
    if (!stats) continue;
    const field = CANONICAL_FIELD_MAP[rule.metric];
    const unit = rule.unit ?? field?.unit ?? "";
    if (compare(stats.mean, rule.comparator, rule.threshold)) {
      newWarnings.push({
        datasetId,
        userId,
        title: rule.name,
        detail: `${field?.label ?? rule.metric}: Ø ${stats.mean}${unit ? " " + unit : ""} verletzt die Regel (Schwellenwert ${rule.threshold}${unit ? " " + unit : ""}).`,
        metric: rule.metric,
        value: stats.mean,
        severity: rule.severity ?? "warning",
        ruleId: rule.id,
      });
    }
  }

  // Anomaly-based warnings for key metrics.
  for (const metric of ["milk_yield_kg", "scc", "fat_pct", "protein_pct"]) {
    if (!presentMetrics.has(metric)) continue;
    const anomaly = await detectAnomalies(datasetId, metric, 2.5);
    if (anomaly && anomaly.outlierCount > 0) {
      const field = CANONICAL_FIELD_MAP[metric];
      newWarnings.push({
        datasetId,
        userId,
        title: `Auffällige Werte: ${field?.label ?? metric}`,
        detail: `${anomaly.outlierCount} Ausreißer außerhalb des Normbereichs (${anomaly.lowerBound}–${anomaly.upperBound}${field?.unit ? " " + field.unit : ""}) erkannt.`,
        metric,
        value: anomaly.outlierCount,
        severity: metric === "scc" ? "critical" : "warning",
        ruleId: null,
      });
    }
  }

  if (newWarnings.length > 0) {
    await db.insert(warningsTable).values(newWarnings);
  }
  return newWarnings.length;
}

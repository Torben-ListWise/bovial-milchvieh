import { and, eq } from "drizzle-orm";
import {
  db,
  rulesTable,
  warningsTable,
  masterDataTable,
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

// Re-evaluate all rules + anomalies + operator master-data reference ranges for a dataset.
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

  // 1. Customer-defined rules.
  const rules: Rule[] = await db
    .select()
    .from(rulesTable)
    .where(and(eq(rulesTable.userId, userId), eq(rulesTable.enabled, true)));

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

  // 2. Operator master-data reference ranges (category = "reference_range").
  //    Expected key format: "<metric>_min" or "<metric>_max".
  const masterRanges = await db
    .select()
    .from(masterDataTable)
    .where(eq(masterDataTable.category, "reference_range"));

  for (const entry of masterRanges) {
    const isMin = entry.key.endsWith("_min");
    const isMax = entry.key.endsWith("_max");
    if (!isMin && !isMax) continue;
    const metric = isMin ? entry.key.slice(0, -4) : entry.key.slice(0, -4);
    if (!presentMetrics.has(metric)) continue;
    const threshold = parseFloat(entry.value);
    if (isNaN(threshold)) continue;
    const stats = await computeMetricStats(datasetId, metric);
    if (!stats) continue;
    const field = CANONICAL_FIELD_MAP[metric];
    const unit = entry.unit ?? field?.unit ?? "";
    const violated = isMin
      ? stats.mean < threshold
      : stats.mean > threshold;
    if (!violated) continue;
    const direction = isMin ? "unter dem Mindestwert" : "über dem Höchstwert";
    newWarnings.push({
      datasetId,
      userId,
      title: `Referenzwert überschritten: ${field?.label ?? metric}`,
      detail: `${field?.label ?? metric}: Ø ${stats.mean}${unit ? " " + unit : ""} liegt ${direction} (${isMin ? "Min" : "Max"}: ${threshold}${unit ? " " + unit : ""}) laut Betriebsstammdaten.`,
      metric,
      value: stats.mean,
      severity: "warning",
      ruleId: null,
    });
  }

  // 3. Statistical anomaly detection for key metrics.
  //    Table-driven: each entry specifies sigma and severity so new metrics
  //    can be added without touching the warning-creation logic.
  const ANOMALY_METRICS: { metric: string; sigma: number; severity: string }[] = [
    { metric: "milk_yield_kg", sigma: 2.5, severity: "warning" },
    { metric: "scc",           sigma: 2.5, severity: "critical" },
    { metric: "fat_pct",       sigma: 2.5, severity: "warning" },
    { metric: "protein_pct",   sigma: 2.5, severity: "warning" },
    // Extended KPIs — present in MLP / DairyComp exports
    { metric: "urea",          sigma: 2.0, severity: "warning" },   // Harnstoff — sensitive metabolic indicator
    { metric: "lactose_pct",   sigma: 2.5, severity: "warning" },   // Laktose
    { metric: "days_in_milk",  sigma: 3.0, severity: "info" },      // DIM outliers often signal data-entry errors
    { metric: "body_weight_kg", sigma: 2.5, severity: "warning" },  // Körpergewicht
    { metric: "milking_count",  sigma: 2.5, severity: "info" },     // Melkungen — AMS-Betriebe
  ];

  for (const { metric, sigma, severity } of ANOMALY_METRICS) {
    if (!presentMetrics.has(metric)) continue;
    const anomaly = await detectAnomalies(datasetId, metric, sigma);
    if (anomaly && anomaly.outlierCount > 0) {
      const field = CANONICAL_FIELD_MAP[metric];
      newWarnings.push({
        datasetId,
        userId,
        title: `Auffällige Werte: ${field?.label ?? metric}`,
        detail: `${anomaly.outlierCount} Ausreißer außerhalb des Normbereichs (${anomaly.lowerBound}–${anomaly.upperBound}${field?.unit ? " " + field.unit : ""}) erkannt.`,
        metric,
        value: anomaly.outlierCount,
        severity,
        ruleId: null,
      });
    }
  }

  if (newWarnings.length > 0) {
    await db.insert(warningsTable).values(newWarnings);
  }
  return newWarnings.length;
}

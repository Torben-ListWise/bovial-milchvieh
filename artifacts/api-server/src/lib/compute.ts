import { eq } from "drizzle-orm";
import { db, dataRowsTable } from "@workspace/db";
import { CANONICAL_FIELD_MAP, CANONICAL_FIELDS } from "./canonical";

export interface LoadedRow {
  recordDate: string | null;
  data: Record<string, number | string>;
}

export interface ComputeBasis {
  rowCount: number;
  dateFrom: string | null;
  dateTo: string | null;
  metric?: string;
}

export interface FieldSummary {
  key: string;
  label: string;
  unit?: string;
  type: string;
  count: number;
}

export interface DatasetSchema {
  fields: FieldSummary[];
  totalRows: number;
  dateFrom: string | null;
  dateTo: string | null;
}

export interface SeriesPoint {
  label: string;
  value: number;
  count: number;
}

async function loadRows(datasetId: string): Promise<LoadedRow[]> {
  const rows = await db
    .select({
      recordDate: dataRowsTable.recordDate,
      data: dataRowsTable.data,
    })
    .from(dataRowsTable)
    .where(eq(dataRowsTable.datasetId, datasetId));
  return rows.map((r) => ({
    recordDate: r.recordDate,
    data: (r.data ?? {}) as Record<string, number | string>,
  }));
}

function numericValues(rows: LoadedRow[], metric: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = r.data[metric];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function dateRange(rows: LoadedRow[]): { from: string | null; to: string | null } {
  let from: string | null = null;
  let to: string | null = null;
  for (const r of rows) {
    if (!r.recordDate) continue;
    if (from === null || r.recordDate < from) from = r.recordDate;
    if (to === null || r.recordDate > to) to = r.recordDate;
  }
  return { from, to };
}

function round(n: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

function std(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  const variance = v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1);
  return Math.sqrt(variance);
}

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function getDatasetSchema(datasetId: string): Promise<DatasetSchema> {
  const rows = await loadRows(datasetId);
  const { from, to } = dateRange(rows);
  const fields: FieldSummary[] = [];
  for (const field of CANONICAL_FIELDS) {
    let count = 0;
    for (const r of rows) {
      if (r.data[field.key] != null) count++;
    }
    if (count > 0) {
      fields.push({
        key: field.key,
        label: field.label,
        unit: field.unit,
        type: field.type,
        count,
      });
    }
  }
  return { fields, totalRows: rows.length, dateFrom: from, dateTo: to };
}

export interface MetricStats {
  metric: string;
  label: string;
  unit?: string;
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  std: number;
  sum: number;
  latest: number | null;
  basis: ComputeBasis;
}

export async function computeMetricStats(
  datasetId: string,
  metric: string,
): Promise<MetricStats | null> {
  const field = CANONICAL_FIELD_MAP[metric];
  if (!field || field.type !== "number") return null;
  const rows = await loadRows(datasetId);
  const values = numericValues(rows, metric);
  if (values.length === 0) return null;

  // Latest value by record date.
  let latest: number | null = null;
  let latestDate: string | null = null;
  for (const r of rows) {
    const v = r.data[metric];
    if (typeof v !== "number") continue;
    if (r.recordDate && (latestDate === null || r.recordDate > latestDate)) {
      latestDate = r.recordDate;
      latest = v;
    }
  }
  const { from, to } = dateRange(rows);
  return {
    metric,
    label: field.label,
    unit: field.unit,
    count: values.length,
    mean: round(mean(values)),
    median: round(median(values)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    std: round(std(values)),
    sum: round(values.reduce((a, b) => a + b, 0)),
    latest: latest != null ? round(latest) : null,
    basis: { rowCount: values.length, dateFrom: from, dateTo: to, metric },
  };
}

export async function computeKpis(datasetId: string): Promise<MetricStats[]> {
  const schema = await getDatasetSchema(datasetId);
  const out: MetricStats[] = [];
  for (const f of schema.fields) {
    if (f.type !== "number") continue;
    const stats = await computeMetricStats(datasetId, f.key);
    if (stats) out.push(stats);
  }
  return out;
}

function bucketLabel(date: string, interval: "day" | "week" | "month"): string {
  if (interval === "month") return date.slice(0, 7);
  if (interval === "day") return date;
  // ISO week bucket.
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export interface TimeseriesResult {
  metric: string;
  label: string;
  unit?: string;
  interval: string;
  aggregation: string;
  points: SeriesPoint[];
  basis: ComputeBasis;
}

export async function computeTimeseries(
  datasetId: string,
  metric: string,
  interval: "day" | "week" | "month" = "month",
  aggregation: "avg" | "sum" = "avg",
): Promise<TimeseriesResult | null> {
  const field = CANONICAL_FIELD_MAP[metric];
  if (!field || field.type !== "number") return null;
  const rows = await loadRows(datasetId);
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const v = r.data[metric];
    if (typeof v !== "number" || !r.recordDate) continue;
    const key = bucketLabel(r.recordDate, interval);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(v);
  }
  const points: SeriesPoint[] = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, vals]) => ({
      label,
      value:
        aggregation === "sum"
          ? round(vals.reduce((a, b) => a + b, 0))
          : round(mean(vals)),
      count: vals.length,
    }));
  const { from, to } = dateRange(rows);
  return {
    metric,
    label: field.label,
    unit: field.unit,
    interval,
    aggregation,
    points,
    basis: { rowCount: rows.length, dateFrom: from, dateTo: to, metric },
  };
}

export interface GroupAggregateResult {
  metric: string;
  groupBy: string;
  aggregation: string;
  points: SeriesPoint[];
  basis: ComputeBasis;
}

export async function computeGroupAggregate(
  datasetId: string,
  metric: string,
  groupBy: string,
  aggregation: "avg" | "sum" | "count" = "avg",
): Promise<GroupAggregateResult | null> {
  const metricField = CANONICAL_FIELD_MAP[metric];
  const groupField = CANONICAL_FIELD_MAP[groupBy];
  if (!metricField || !groupField) return null;
  const rows = await loadRows(datasetId);
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const g = r.data[groupBy];
    const v = r.data[metric];
    if (g == null || typeof v !== "number") continue;
    const key = String(g);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(v);
  }
  const points: SeriesPoint[] = [...buckets.entries()]
    .map(([label, vals]) => ({
      label,
      value:
        aggregation === "sum"
          ? round(vals.reduce((a, b) => a + b, 0))
          : aggregation === "count"
            ? vals.length
            : round(mean(vals)),
      count: vals.length,
    }))
    .sort((a, b) => (a.label < b.label ? -1 : 1));
  const { from, to } = dateRange(rows);
  return {
    metric,
    groupBy,
    aggregation,
    points,
    basis: { rowCount: rows.length, dateFrom: from, dateTo: to, metric },
  };
}

export interface RankingEntry {
  animalId: string;
  value: number;
  count: number;
}

export async function computeAnimalRanking(
  datasetId: string,
  metric: string,
  order: "asc" | "desc" = "desc",
  limit = 10,
): Promise<{ metric: string; entries: RankingEntry[]; basis: ComputeBasis } | null> {
  const field = CANONICAL_FIELD_MAP[metric];
  if (!field || field.type !== "number") return null;
  const rows = await loadRows(datasetId);
  const byAnimal = new Map<string, number[]>();
  for (const r of rows) {
    const id = r.data["animal_id"];
    const v = r.data[metric];
    if (id == null || typeof v !== "number") continue;
    const key = String(id);
    if (!byAnimal.has(key)) byAnimal.set(key, []);
    byAnimal.get(key)!.push(v);
  }
  const entries: RankingEntry[] = [...byAnimal.entries()].map(([animalId, vals]) => ({
    animalId,
    value: round(mean(vals)),
    count: vals.length,
  }));
  entries.sort((a, b) => (order === "desc" ? b.value - a.value : a.value - b.value));
  const { from, to } = dateRange(rows);
  return {
    metric,
    entries: entries.slice(0, limit),
    basis: { rowCount: rows.length, dateFrom: from, dateTo: to, metric },
  };
}

export interface AnomalyResult {
  metric: string;
  label: string;
  unit?: string;
  mean: number;
  std: number;
  lowerBound: number;
  upperBound: number;
  outlierCount: number;
  outliers: { animalId: string | null; value: number; date: string | null }[];
  basis: ComputeBasis;
}

export interface DashboardKpi {
  key: string;
  label: string;
  value: number | null;
  unit?: string | null;
  deltaPct?: number | null;
  trend?: "up" | "down" | "flat" | null;
  basis?: string | null;
}

export interface DashboardChart {
  id: string;
  type: "line" | "bar" | "area" | "pie" | "scatter" | "table";
  title: string;
  description?: string | null;
  xKey?: string | null;
  series?: { key: string; label: string }[];
  data: Record<string, unknown>[];
  unit?: string | null;
  basis?: string | null;
}

const DASHBOARD_METRICS = [
  "milk_yield_kg",
  "fat_pct",
  "protein_pct",
  "scc",
  "urea",
  "feed_intake_kg",
];

export async function computeDashboard(
  datasetId: string,
): Promise<{ kpis: DashboardKpi[]; charts: DashboardChart[] }> {
  const rows = await loadRows(datasetId);
  const { from, to } = dateRange(rows);
  const basis = (n: number) =>
    `Basis: ${n} Datensätze${from && to ? `, Zeitraum ${from} bis ${to}` : ""}`;

  const monthly = (metric: string): SeriesPoint[] => {
    const buckets = new Map<string, number[]>();
    for (const r of rows) {
      const v = r.data[metric];
      if (typeof v !== "number" || !r.recordDate) continue;
      const key = r.recordDate.slice(0, 7);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(v);
    }
    return [...buckets.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([label, vals]) => ({ label, value: round(mean(vals)), count: vals.length }));
  };

  const kpis: DashboardKpi[] = [];
  for (const metric of DASHBOARD_METRICS) {
    const field = CANONICAL_FIELD_MAP[metric];
    if (!field) continue;
    const values = numericValues(rows, metric);
    if (values.length === 0) continue;
    const points = monthly(metric);
    const value = points.length ? points[points.length - 1].value : round(mean(values));
    let deltaPct: number | null = null;
    let trend: "up" | "down" | "flat" | null = null;
    if (points.length >= 2) {
      const prev = points[points.length - 2].value;
      const cur = points[points.length - 1].value;
      if (prev !== 0) {
        deltaPct = round(((cur - prev) / Math.abs(prev)) * 100, 1);
        trend = deltaPct > 1 ? "up" : deltaPct < -1 ? "down" : "flat";
      }
    }
    kpis.push({
      key: metric,
      label: field.label,
      value,
      unit: field.unit ?? null,
      deltaPct,
      trend,
      basis: basis(values.length),
    });
  }

  const charts: DashboardChart[] = [];
  for (const metric of ["milk_yield_kg", "scc", "fat_pct"]) {
    const field = CANONICAL_FIELD_MAP[metric];
    if (!field) continue;
    const points = monthly(metric);
    if (points.length < 2) continue;
    charts.push({
      id: `dash_${metric}`,
      type: "line",
      title: `${field.label} im Zeitverlauf`,
      xKey: "label",
      series: [{ key: "value", label: field.label + (field.unit ? ` (${field.unit})` : "") }],
      data: points.map((p) => ({ label: p.label, value: p.value, count: p.count })),
      unit: field.unit ?? null,
      basis: basis(rows.length),
    });
    if (charts.length >= 3) break;
  }

  return { kpis, charts };
}

export async function detectAnomalies(
  datasetId: string,
  metric: string,
  sigma = 2,
): Promise<AnomalyResult | null> {
  const field = CANONICAL_FIELD_MAP[metric];
  if (!field || field.type !== "number") return null;
  const rows = await loadRows(datasetId);
  const values = numericValues(rows, metric);
  if (values.length < 3) return null;
  const m = mean(values);
  const s = std(values);
  const lower = m - sigma * s;
  const upper = m + sigma * s;
  const outliers: AnomalyResult["outliers"] = [];
  for (const r of rows) {
    const v = r.data[metric];
    if (typeof v !== "number") continue;
    if (v < lower || v > upper) {
      outliers.push({
        animalId: r.data["animal_id"] != null ? String(r.data["animal_id"]) : null,
        value: round(v),
        date: r.recordDate,
      });
    }
  }
  outliers.sort((a, b) => Math.abs(b.value - m) - Math.abs(a.value - m));
  const { from, to } = dateRange(rows);
  return {
    metric,
    label: field.label,
    unit: field.unit,
    mean: round(m),
    std: round(s),
    lowerBound: round(lower),
    upperBound: round(upper),
    outlierCount: outliers.length,
    outliers: outliers.slice(0, 25),
    basis: { rowCount: values.length, dateFrom: from, dateTo: to, metric },
  };
}

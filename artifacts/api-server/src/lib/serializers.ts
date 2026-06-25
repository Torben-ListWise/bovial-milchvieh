import type { Dataset, SourceFile, MasterDataEntry } from "@workspace/db";

export function mapDatasetStatus(
  status: string,
): "empty" | "ingesting" | "ready" | "error" {
  switch (status) {
    case "processing":
    case "uploaded":
      return "ingesting";
    case "ready":
    case "needs_mapping":
      return "ready";
    case "error":
      return "error";
    default:
      return "empty";
  }
}

export function mapFileStatus(
  status: string,
): "uploaded" | "parsing" | "mapping" | "ready" | "error" {
  switch (status) {
    case "processing":
      return "parsing";
    case "needs_mapping":
      return "mapping";
    case "ready":
      return "ready";
    case "error":
      return "error";
    default:
      return "uploaded";
  }
}

export function deriveFileKind(
  name: string,
): "excel" | "csv" | "herd_export" | "pdf" | "ppt" | "other" {
  const l = name.toLowerCase();
  if (l.endsWith(".xlsx") || l.endsWith(".xls")) return "excel";
  if (l.endsWith(".csv") || l.endsWith(".tsv")) return "csv";
  if (l.endsWith(".pdf")) return "pdf";
  if (l.endsWith(".pptx") || l.endsWith(".ppt")) return "ppt";
  return "other";
}

export function normalizeSector(
  sector: string | null | undefined,
): "dairy" | "biogas" | "arable" {
  if (sector === "biogas" || sector === "arable") return sector;
  return "dairy";
}

export function serializeDataset(
  d: Dataset,
  fileCount: number,
  rowCount: number,
) {
  return {
    id: d.id,
    name: d.name,
    description: d.description ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt ?? null,
    fileCount,
    rowCount,
    status: mapDatasetStatus(d.status),
    sector: normalizeSector((d as any).sector),
    periodStart: d.periodStart ?? null,
    periodEnd: d.periodEnd ?? null,
    detectedFocusArea: (d as any).detectedFocusArea ?? null,
    detectedFocusAreaConfidence: (d as any).detectedFocusAreaConfidence ?? null,
  };
}

interface StoredColumn {
  header: string;
  samples?: string[];
  suggestedField?: string | null;
  confidence?: number;
}

export function serializeFile(f: SourceFile, includeDetail = false) {
  const storedKind = (f as any).kind as string | null | undefined;
  const base = {
    id: f.id,
    datasetId: f.datasetId,
    name: f.name,
    contentType: f.contentType ?? null,
    size: f.size ?? null,
    status: mapFileStatus(f.status),
    kind: storedKind ?? deriveFileKind(f.name),
    rowCount: f.rowCount ?? null,
    errorMessage: f.errorMessage ?? null,
    createdAt: f.createdAt,
    previewRows: (f.previewRows as Record<string, unknown>[] | null) ?? [],
  };
  if (!includeDetail) return base;

  const mapping = (f.mapping as Record<string, string> | null) ?? {};
  const storedColumns = (f.columns as StoredColumn[] | null) ?? [];
  const columns = storedColumns.map((c) => ({
    sourceColumn: c.header,
    sampleValues: c.samples ?? [],
    canonicalField: mapping[c.header] ?? c.suggestedField ?? null,
    confidence: c.confidence ?? null,
  }));
  return {
    ...base,
    columns,
  };
}

export function serializeMasterData(e: MasterDataEntry) {
  return {
    id: e.id,
    category: e.category,
    key: e.key,
    value: e.value,
    unit: e.unit ?? null,
    notes: e.notes ?? null,
    sector: (e as any).sector ?? null,
    createdAt: e.createdAt,
  };
}

import type { Dataset, SourceFile } from "@workspace/db";

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
    periodStart: d.periodStart ?? null,
    periodEnd: d.periodEnd ?? null,
  };
}

interface StoredColumn {
  header: string;
  samples?: string[];
  suggestedField?: string | null;
  confidence?: number;
}

export function serializeFile(f: SourceFile, includeDetail = false) {
  const base = {
    id: f.id,
    datasetId: f.datasetId,
    name: f.name,
    contentType: f.contentType ?? null,
    size: f.size ?? null,
    status: mapFileStatus(f.status),
    kind: deriveFileKind(f.name),
    rowCount: f.rowCount ?? null,
    errorMessage: f.errorMessage ?? null,
    createdAt: f.createdAt,
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
    previewRows: (f.previewRows as Record<string, unknown>[] | null) ?? [],
  };
}

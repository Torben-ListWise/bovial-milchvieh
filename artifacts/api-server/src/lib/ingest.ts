import * as XLSX from "xlsx";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import {
  db,
  sourceFilesTable,
  dataRowsTable,
  datasetsTable,
  type SourceFile,
} from "@workspace/db";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "./objectStorage";
import {
  suggestCanonicalField,
  parseCanonicalValue,
  CANONICAL_FIELD_MAP,
} from "./canonical";
import { evaluateWarnings } from "./warnings";
import { runAgent } from "./agent";
import { analysesTable, messagesTable } from "@workspace/db";
import { logger } from "./logger";

const objectStorage = new ObjectStorageService();

export type FileKind = "spreadsheet" | "document" | "unknown";

export interface ColumnInfo {
  header: string;
  samples: string[];
  suggestedField: string | null;
  confidence: number;
}

export interface AnalyzeResult {
  kind: FileKind;
  columns: ColumnInfo[];
  previewRows: Record<string, unknown>[];
  suggestedMapping: Record<string, string>; // header -> canonical key
  text?: string;
  rows2d?: string[][]; // raw rows incl. header for tabular files
}

function detectKind(name: string, contentType?: string | null): FileKind {
  const lower = name.toLowerCase();
  const ct = (contentType ?? "").toLowerCase();
  if (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".tsv") ||
    ct.includes("spreadsheet") ||
    ct.includes("csv") ||
    ct.includes("excel")
  )
    return "spreadsheet";
  if (
    lower.endsWith(".pdf") ||
    lower.endsWith(".pptx") ||
    lower.endsWith(".ppt") ||
    ct.includes("pdf") ||
    ct.includes("presentation")
  )
    return "document";
  return "unknown";
}

function decodeBuffer(buf: Buffer): string {
  const utf8 = buf.toString("utf-8");
  if (utf8.includes("\uFFFD")) {
    return buf.toString("latin1");
  }
  return utf8;
}

function detectDelimiter(headerLine: string): string {
  const candidates = [";", "\t", ","];
  let best = ",";
  let bestCount = -1;
  for (const c of candidates) {
    const count = headerLine.split(c).length;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

function parseCSV(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = normalized.split("\n", 1)[0] ?? "";
  const delim = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function parseSpreadsheet(buf: Buffer, name: string): string[][] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    return parseCSV(decodeBuffer(buf));
  }
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  });
  return json.map((r) => r.map((c) => (c == null ? "" : String(c))));
}

async function extractPdfText(buf: Buffer): Promise<string> {
  try {
    // @ts-expect-error - deep import has no bundled type declarations
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse = (mod as { default: (b: Buffer) => Promise<{ text: string }> })
      .default;
    const result = await pdfParse(buf);
    return result.text ?? "";
  } catch (err) {
    logger.warn({ err }, "PDF-Textextraktion fehlgeschlagen");
    return "";
  }
}

async function extractPptxText(buf: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort();
    const parts: string[] = [];
    for (const fname of slideFiles) {
      const xml = await zip.files[fname].async("string");
      const texts = xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? [];
      const slideText = texts
        .map((t) => t.replace(/<a:t>/, "").replace(/<\/a:t>/, ""))
        .join(" ");
      if (slideText.trim()) parts.push(slideText.trim());
    }
    return parts.join("\n\n");
  } catch (err) {
    logger.warn({ err }, "PPTX-Textextraktion fehlgeschlagen");
    return "";
  }
}

// Scan up to the first MAX_HEADER_SCAN rows and return the index of the row
// that has the most canonical-field header matches. Handles exports where
// the first N rows are metadata / title lines before the actual data header.
const MAX_HEADER_SCAN = 10;
function detectHeaderRow(rows2d: string[][]): number {
  const limit = Math.min(rows2d.length, MAX_HEADER_SCAN);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < limit; i++) {
    const row = rows2d[i];
    const score = row.filter((cell) => suggestCanonicalField(cell.trim()) !== null).length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

async function downloadBytes(objectPath: string): Promise<Buffer> {
  const file = await objectStorage.getObjectEntityFile(objectPath);
  const [buf] = await file.download();
  return buf;
}

export async function analyzeFile(file: SourceFile): Promise<AnalyzeResult> {
  const kind = detectKind(file.name, file.contentType);
  const buf = await downloadBytes(file.objectPath);

  if (kind === "document") {
    const lower = file.name.toLowerCase();
    const text =
      lower.endsWith(".pdf") || (file.contentType ?? "").includes("pdf")
        ? await extractPdfText(buf)
        : await extractPptxText(buf);
    return {
      kind,
      columns: [],
      previewRows: [],
      suggestedMapping: {},
      text,
    };
  }

  const rows2d = parseSpreadsheet(buf, file.name);
  if (rows2d.length === 0) {
    return {
      kind: "spreadsheet",
      columns: [],
      previewRows: [],
      suggestedMapping: {},
      rows2d: [],
    };
  }

  // Detect header row: scan up to the first 10 rows and pick the one with the
  // highest number of canonical-field matches. Handles exports where the first
  // several rows are metadata / title lines.
  const headerRowIdx = detectHeaderRow(rows2d);
  const headers = rows2d[headerRowIdx].map((h, i) => h.trim() || `Spalte ${i + 1}`);
  const dataRows = rows2d.slice(headerRowIdx + 1);

  const columns: ColumnInfo[] = headers.map((header, idx) => {
    const samples = dataRows
      .slice(0, 5)
      .map((r) => (r[idx] ?? "").toString().trim())
      .filter(Boolean);
    const suggestion = suggestCanonicalField(header);
    return {
      header,
      samples,
      suggestedField: suggestion?.key ?? null,
      confidence: suggestion?.confidence ?? 0,
    };
  });

  // Build suggested mapping; avoid mapping two headers to the same canonical key.
  const suggestedMapping: Record<string, string> = {};
  const used = new Set<string>();
  const sorted = [...columns].sort((a, b) => b.confidence - a.confidence);
  for (const col of sorted) {
    if (col.suggestedField && !used.has(col.suggestedField)) {
      suggestedMapping[col.header] = col.suggestedField;
      used.add(col.suggestedField);
    }
  }

  const previewRows = dataRows.slice(0, 10).map((r) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] ?? "";
    });
    return obj;
  });

  return {
    kind: "spreadsheet",
    columns,
    previewRows,
    suggestedMapping,
    rows2d,
  };
}

// Convert raw spreadsheet rows into canonical data_rows using a header->canonical map.
export async function materializeRows(
  file: SourceFile,
  mapping: Record<string, string>,
  rows2d: string[][],
): Promise<number> {
  await db.delete(dataRowsTable).where(eq(dataRowsTable.fileId, file.id));
  if (rows2d.length < 2) return 0;

  const headerRowIdx = detectHeaderRow(rows2d);
  const headers = rows2d[headerRowIdx].map((h, i) => h.trim() || `Spalte ${i + 1}`);
  const headerToCanonical = new Map<number, string>();
  headers.forEach((h, idx) => {
    const canonical = mapping[h];
    if (canonical && CANONICAL_FIELD_MAP[canonical]) {
      headerToCanonical.set(idx, canonical);
    }
  });
  if (headerToCanonical.size === 0) return 0;

  const inserts: {
    datasetId: string;
    fileId: string;
    recordDate: string | null;
    data: Record<string, number | string>;
  }[] = [];

  for (const row of rows2d.slice(headerRowIdx + 1)) {
    const data: Record<string, number | string> = {};
    let recordDate: string | null = null;
    for (const [idx, canonical] of headerToCanonical) {
      const parsed = parseCanonicalValue(canonical, row[idx]);
      if (parsed == null) continue;
      data[canonical] = parsed;
      if (canonical === "date" && typeof parsed === "string") {
        recordDate = parsed;
      }
    }
    if (Object.keys(data).length === 0) continue;
    inserts.push({
      datasetId: file.datasetId,
      fileId: file.id,
      recordDate,
      data,
    });
  }

  const BATCH = 500;
  for (let i = 0; i < inserts.length; i += BATCH) {
    await db.insert(dataRowsTable).values(inserts.slice(i, i + BATCH));
  }
  return inserts.length;
}

// Full background ingestion: analyze, auto-apply suggested mapping, materialize.
export async function ingestFile(fileId: string): Promise<void> {
  const [file] = await db
    .select()
    .from(sourceFilesTable)
    .where(eq(sourceFilesTable.id, fileId));
  if (!file) return;

  try {
    await db
      .update(sourceFilesTable)
      .set({ status: "processing" })
      .where(eq(sourceFilesTable.id, fileId));

    const result = await analyzeFile(file);

    if (result.kind === "document") {
      await db
        .update(sourceFilesTable)
        .set({
          status: "ready",
          kind: "document",
          rowCount: 0,
          previewRows: result.text
            ? [{ text: result.text.slice(0, 20000) }]
            : [],
        })
        .where(eq(sourceFilesTable.id, fileId));
    } else {
      const rowCount = await materializeRows(
        file,
        result.suggestedMapping,
        result.rows2d ?? [],
      );
      const needsMapping =
        Object.keys(result.suggestedMapping).length === 0 && rowCount === 0;
      await db
        .update(sourceFilesTable)
        .set({
          status: needsMapping ? "needs_mapping" : "ready",
          kind: "spreadsheet",
          rowCount,
          columns: result.columns,
          mapping: result.suggestedMapping,
          previewRows: result.previewRows,
        })
        .where(eq(sourceFilesTable.id, fileId));
    }

    await refreshDatasetStatus(file.datasetId);
    try {
      await evaluateWarnings(file.datasetId, file.userId);
    } catch (err) {
      logger.warn({ err, datasetId: file.datasetId }, "Warnungsauswertung fehlgeschlagen");
    }
    // Automatische Erstanalyse nach erfolgreichem Ingest.
    try {
      const [analysis] = await db
        .insert(analysesTable)
        .values({
          datasetId: file.datasetId,
          userId: file.userId,
          title: "Automatische Erstanalyse",
          category: "overview",
          source: "auto",
        })
        .returning();
      const question =
        "Bitte erstelle eine kurze Erstanalyse der hochgeladenen Betriebsdaten: Welche Kennzahlen sind vorhanden, wie sieht die Datenqualität aus und gibt es erste auffällige Werte?";
      const result = await runAgent({
        datasetId: file.datasetId,
        conversation: [{ role: "user", content: question }],
      });
      await db.insert(messagesTable).values({
        analysisId: analysis.id,
        role: "user",
        content: question,
      });
      await db.insert(messagesTable).values({
        analysisId: analysis.id,
        role: "assistant",
        content: result.text,
        charts: result.charts as unknown as Record<string, unknown>[],
        citations: result.citations as unknown as Record<string, unknown>[],
      });
    } catch (err) {
      logger.warn({ err, datasetId: file.datasetId }, "Automatische Erstanalyse fehlgeschlagen");
    }
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      logger.error({ fileId }, "Datei im Speicher nicht gefunden");
    }
    logger.error({ err, fileId }, "Ingestion fehlgeschlagen");
    await db
      .update(sourceFilesTable)
      .set({
        status: "error",
        errorMessage:
          err instanceof Error ? err.message : "Unbekannter Fehler",
      })
      .where(eq(sourceFilesTable.id, fileId));
  }
}

// Re-apply a (possibly user-edited) mapping to a tabular file.
export async function remapFile(
  fileId: string,
  mapping: Record<string, string>,
): Promise<number> {
  const [file] = await db
    .select()
    .from(sourceFilesTable)
    .where(eq(sourceFilesTable.id, fileId));
  if (!file) throw new Error("Datei nicht gefunden");

  const result = await analyzeFile(file);
  const rowCount = await materializeRows(file, mapping, result.rows2d ?? []);
  await db
    .update(sourceFilesTable)
    .set({
      status: rowCount > 0 ? "ready" : "needs_mapping",
      mapping,
      rowCount,
    })
    .where(eq(sourceFilesTable.id, fileId));
  await refreshDatasetStatus(file.datasetId);
  return rowCount;
}

async function refreshDatasetStatus(datasetId: string): Promise<void> {
  const files = await db
    .select()
    .from(sourceFilesTable)
    .where(eq(sourceFilesTable.datasetId, datasetId));
  let status = "empty";
  if (files.length > 0) {
    if (files.some((f) => f.status === "processing" || f.status === "uploaded"))
      status = "processing";
    else if (files.some((f) => f.status === "ready")) status = "ready";
    else if (files.some((f) => f.status === "needs_mapping"))
      status = "needs_mapping";
    else if (files.every((f) => f.status === "error")) status = "error";
  }
  await db
    .update(datasetsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(datasetsTable.id, datasetId));
}

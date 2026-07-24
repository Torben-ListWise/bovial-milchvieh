// Polyfills required by pdf-parse (uses browser canvas APIs internally)
if (typeof (globalThis as any).DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a=1;b=0;c=0;d=1;e=0;f=0;
    m11=1;m12=0;m13=0;m14=0;m21=0;m22=1;m23=0;m24=0;
    m31=0;m32=0;m33=1;m34=0;m41=0;m42=0;m43=0;m44=1;
    is2D=true;isIdentity=true;
    constructor(_init?: string | number[]) {}
    transformPoint(p?: {x?:number;y?:number}) { return p ?? {x:0,y:0}; }
  };
}
if (typeof (globalThis as any).ImageData === "undefined") {
  (globalThis as any).ImageData = class ImageData {
    constructor(public data: Uint8ClampedArray | number, public width: number, public height?: number) {}
  };
}
if (typeof (globalThis as any).Path2D === "undefined") {
  (globalThis as any).Path2D = class Path2D {
    addPath() {} moveTo() {} lineTo() {} arc() {} closePath() {}
  };
}

import * as XLSX from "xlsx";
import JSZip from "jszip";
import { and, eq } from "drizzle-orm";
import {
  db,
  sourceFilesTable,
  dataRowsTable,
  datasetsTable,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
  cowEventsTable,
  type SourceFile,
  type EventImportSummary,
} from "@workspace/db";
import { detectEventColumns, parseEventRows } from "./parseEvents";
import { createHash } from "node:crypto";
import { chunkText, embedTexts, LOCAL_MODEL_NAME } from "./embeddings";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "./objectStorage";
import {
  suggestCanonicalField,
  parseCanonicalValue,
  CANONICAL_FIELD_MAP,
} from "./canonical";
import { detectFarmType } from "./farmTypeDetector";
import {
  parseCowfile,
  CowfileParseError,
  type CowfileParseResult,
} from "./parseCowfile";
import * as fsSync from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { evaluateWarnings } from "./warnings";
import { analysesTable, messagesTable } from "@workspace/db";
import { processQuestion } from "./analysisService";
import { logger } from "./logger";

const objectStorage = new ObjectStorageService();

export type FileKind = "spreadsheet" | "document" | "cowfile" | "unknown";

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
  if (lower.endsWith(".dat")) return "cowfile";
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

async function getPdfjsDoc(buf: Buffer) {
  const { getDocument, GlobalWorkerOptions } = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const workerPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  GlobalWorkerOptions.workerSrc = workerPath;
  const data = new Uint8Array(buf);
  return getDocument({ data, useSystemFonts: true }).promise;
}

export async function extractPdfText(buf: Buffer): Promise<string> {
  const doc = await getPdfjsDoc(buf);
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item) => "str" in item)
      .map((item) => (item as unknown as { str: string }).str)
      .join(" ");
    parts.push(pageText);
  }
  return parts.join("\n\n");
}

export async function extractPdfMeta(buf: Buffer): Promise<{ title?: string; author?: string }> {
  try {
    const doc = await getPdfjsDoc(buf);
    const meta = await doc.getMetadata();
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    return {
      title: typeof info["Title"] === "string" && info["Title"] ? info["Title"] : undefined,
      author: typeof info["Author"] === "string" && info["Author"] ? info["Author"] : undefined,
    };
  } catch {
    return {};
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

async function extractDocxText(buf: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const docXml = zip.files["word/document.xml"];
    if (!docXml) return "";
    const xml = await docXml.async("string");
    // Extract text runs, insert newline at paragraph boundaries
    const text = xml
      .replace(/<w:p[ >]/g, "\n<w:p ")
      .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text;
  } catch (err) {
    logger.warn({ err }, "DOCX-Textextraktion fehlgeschlagen");
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

// Detect if a CSV is a livestock event file and ingest events into cow_events table.
// Returns an EventImportSummary if it was a livestock event file, or null otherwise.
export async function tryIngestLivestockEvents(
  file: SourceFile,
  rows2d: string[][],
): Promise<EventImportSummary | null> {
  if (rows2d.length < 2) return null;

  // Find the best header row (same logic as detectHeaderRow but for event columns)
  const MAX_SCAN = 10;
  const limit = Math.min(rows2d.length, MAX_SCAN);
  let bestHeaderIdx = 0;
  let bestMapping = detectEventColumns(rows2d[0] ?? []);

  for (let i = 1; i < limit; i++) {
    const m = detectEventColumns(rows2d[i]);
    if (m && !bestMapping) {
      bestMapping = m;
      bestHeaderIdx = i;
    }
  }

  if (!bestMapping) return null;

  const { events, skippedInvalid } = parseEventRows(rows2d, bestHeaderIdx, bestMapping, file.datasetId);

  if (events.length === 0) return null;

  // Batch insert with ON CONFLICT DO NOTHING (deduplication)
  const BATCH = 500;
  let inserted = 0;
  let skippedDuplicates = 0;

  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH);
    const rows = batch.map((e) => ({
      datasetId: file.datasetId,
      fileId: file.id,
      animalId: e.animalId,
      eventDate: e.eventDate,
      eventType: e.eventType,
      dim: e.dim,
      remark: e.remark,
      result: e.result,
      technician: e.technician,
      rawExtra: e.rawExtra,
      rowHash: e.rowHash,
    }));

    const result = await db
      .insert(cowEventsTable)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: cowEventsTable.id });
    inserted += result.length;
    skippedDuplicates += batch.length - result.length;
  }

  // Compute summary stats
  const typeCounts = new Map<string, number>();
  const animals = new Set<string>();
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const e of events) {
    typeCounts.set(e.eventType, (typeCounts.get(e.eventType) ?? 0) + 1);
    animals.add(e.animalId);
    if (!minDate || e.eventDate < minDate) minDate = e.eventDate;
    if (!maxDate || e.eventDate > maxDate) maxDate = e.eventDate;
  }

  const topEvents = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => ({ type, count }));

  const summary: EventImportSummary = {
    inserted,
    skippedDuplicates,
    skippedInvalid,
    topEvents,
    dateRange: minDate && maxDate ? { from: minDate, to: maxDate } : null,
    animals: animals.size,
  };

  logger.info(
    { datasetId: file.datasetId, inserted, skippedDuplicates, skippedInvalid, animals: animals.size },
    "Livestock-Events importiert",
  );

  return summary;
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

export interface CowfileSummary {
  farmName: string | null;
  versionInfo: string | null;
  totalSlots: number;
  occupiedSlots: number;
  cows: number;
  lactations: number;
  eventsInserted: number;
  eventsSkippedDuplicates: number;
  topEvents: { type: string; count: number }[];
  dateRange: { from: string; to: string } | null;
}

// Ingest a DairyComp-305 COWFILE1.DAT: stream to a temp file, parse the binary
// format, and materialize cows/lactations into data_rows plus events into cow_events.
// Fails loudly: on any insert error all partially written rows for this file are
// removed and the error is rethrown (no silent partial imports).
async function ingestCowfileFile(file: SourceFile): Promise<CowfileSummary> {
  const tmpPath = path.join(
    os.tmpdir(),
    `cowfile-${file.id}-${Date.now()}.dat`,
  );
  const storageFile = await objectStorage.getObjectEntityFile(file.objectPath);
  await pipeline(
    storageFile.createReadStream(),
    fsSync.createWriteStream(tmpPath),
  );

  try {
    const parsed: CowfileParseResult = parseCowfile(tmpPath);

    // Re-ingest support: remove any previous rows from this file first.
    await db.delete(dataRowsTable).where(eq(dataRowsTable.fileId, file.id));
    await db.delete(cowEventsTable).where(eq(cowEventsTable.fileId, file.id));

    let eventsInserted = 0;
    let eventsSkippedDuplicates = 0;

    try {
      // Cows → data_rows (one row per animal, recordDate = birth date)
      const cowRows = parsed.cows.map((c) => {
        const data: Record<string, number | string> = {
          animal_id: c.animalId,
        };
        if (c.lactationNumber != null) data.lactation_number = c.lactationNumber;
        if (c.birthDate) data.birth_date = c.birthDate;
        if (c.breed) data.breed = c.breed;
        if (c.pen != null) data.pen = c.pen;
        if (c.reproCode != null) data.repro_code = c.reproCode;
        if (c.registration) data.registration = c.registration;
        if (c.freshDate) data.fresh_date = c.freshDate;
        if (c.conceptionDate) data.conception_date = c.conceptionDate;
        if (c.dryDate) data.dry_date = c.dryDate;
        return {
          datasetId: file.datasetId,
          fileId: file.id,
          recordDate: c.birthDate,
          data,
        };
      });

      // Lactation history → data_rows (one row per lactation, recordDate = fresh date)
      const lactRows = parsed.lactations.map((l) => {
        const data: Record<string, number | string> = {
          animal_id: l.animalId,
          lactation_number: l.lactationNumber,
        };
        if (l.freshDate) data.fresh_date = l.freshDate;
        if (l.conceptionDate) data.conception_date = l.conceptionDate;
        if (l.dryDate) data.dry_date = l.dryDate;
        return {
          datasetId: file.datasetId,
          fileId: file.id,
          recordDate: l.freshDate,
          data,
        };
      });

      const BATCH = 500;
      const allDataRows = [...cowRows, ...lactRows];
      for (let i = 0; i < allDataRows.length; i += BATCH) {
        await db.insert(dataRowsTable).values(allDataRows.slice(i, i + BATCH));
      }

      // Events → cow_events (deduped via rowHash)
      const eventRows = parsed.events.map((e) => {
        const remark = e.remark ?? null;
        const hashInput = `${file.datasetId}|${e.animalId}|${e.eventDate}|${e.eventType}|${remark ?? ""}`;
        return {
          datasetId: file.datasetId,
          fileId: file.id,
          animalId: e.animalId,
          eventDate: e.eventDate,
          eventType: e.eventType,
          dim: null as number | null,
          remark,
          result: null as string | null,
          technician: null as string | null,
          rawExtra: { code: e.eventCode, protocol: e.protocol },
          rowHash: createHash("sha256").update(hashInput).digest("hex"),
        };
      });
      for (let i = 0; i < eventRows.length; i += BATCH) {
        const batch = eventRows.slice(i, i + BATCH);
        const inserted = await db
          .insert(cowEventsTable)
          .values(batch)
          .onConflictDoNothing()
          .returning({ id: cowEventsTable.id });
        eventsInserted += inserted.length;
        eventsSkippedDuplicates += batch.length - inserted.length;
      }
    } catch (err) {
      // Loud failure: never leave a partial import behind.
      await db
        .delete(dataRowsTable)
        .where(eq(dataRowsTable.fileId, file.id))
        .catch(() => {});
      await db
        .delete(cowEventsTable)
        .where(eq(cowEventsTable.fileId, file.id))
        .catch(() => {});
      throw err;
    }

    // Set the farm name as dataset description if none is set yet.
    if (parsed.farmName) {
      const [ds] = await db
        .select({ description: datasetsTable.description })
        .from(datasetsTable)
        .where(eq(datasetsTable.id, file.datasetId));
      if (ds && !ds.description) {
        await db
          .update(datasetsTable)
          .set({ description: parsed.farmName, updatedAt: new Date() })
          .where(eq(datasetsTable.id, file.datasetId));
      }
    }

    const typeCounts = new Map<string, number>();
    let minDate: string | null = null;
    let maxDate: string | null = null;
    for (const e of parsed.events) {
      typeCounts.set(e.eventType, (typeCounts.get(e.eventType) ?? 0) + 1);
      if (!minDate || e.eventDate < minDate) minDate = e.eventDate;
      if (!maxDate || e.eventDate > maxDate) maxDate = e.eventDate;
    }
    const topEvents = [...typeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));

    const summary: CowfileSummary = {
      farmName: parsed.farmName,
      versionInfo: parsed.versionInfo,
      totalSlots: parsed.totalSlots,
      occupiedSlots: parsed.occupiedSlots,
      cows: parsed.cows.length,
      lactations: parsed.lactations.length,
      eventsInserted,
      eventsSkippedDuplicates,
      topEvents,
      dateRange: minDate && maxDate ? { from: minDate, to: maxDate } : null,
    };

    logger.info(
      {
        datasetId: file.datasetId,
        fileId: file.id,
        farmName: parsed.farmName,
        cows: parsed.cows.length,
        lactations: parsed.lactations.length,
        eventsInserted,
      },
      "COWFILE-Import abgeschlossen",
    );

    return summary;
  } finally {
    await fsp.unlink(tmpPath).catch(() => {});
  }
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

    const preKind = detectKind(file.name, file.contentType);

    let result: AnalyzeResult | null = null;
    if (preKind === "cowfile") {
      const cowfileSummary = await ingestCowfileFile(file);
      await db
        .update(sourceFilesTable)
        .set({
          status: "ready",
          kind: "herd_export",
          rowCount: cowfileSummary.cows + cowfileSummary.lactations,
          previewRows: [{ cowfileSummary }],
        })
        .where(eq(sourceFilesTable.id, fileId));

      // COWFILE1.DAT is a DairyComp-305 herd file — definitively a dairy farm.
      const [existing] = await db
        .select({ c: (datasetsTable as any).detectedFocusAreaConfidence })
        .from(datasetsTable)
        .where(eq(datasetsTable.id, file.datasetId));
      const existingConf = (existing?.c as number | null) ?? 0;
      if (existingConf < 0.9) {
        await db
          .update(datasetsTable)
          .set({
            detectedFocusArea: "milchvieh",
            detectedFocusAreaConfidence: 0.9,
            updatedAt: new Date(),
          } as any)
          .where(eq(datasetsTable.id, file.datasetId));
      }
    } else {
      result = await analyzeFile(file);
    }

    if (result === null) {
      // cowfile: handled above
    } else if (result.kind === "document") {
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
      // Try livestock event detection first before normal materialization
      const eventSummary = await tryIngestLivestockEvents(file, result.rows2d ?? []).catch((err) => {
        logger.warn({ err, fileId }, "Livestock-Event-Ingestion fehlgeschlagen — fahre mit normalem Pfad fort");
        return null;
      });

      const rowCount = await materializeRows(
        file,
        result.suggestedMapping,
        result.rows2d ?? [],
      );
      const needsMapping =
        Object.keys(result.suggestedMapping).length === 0 && rowCount === 0 && !eventSummary;
      await db
        .update(sourceFilesTable)
        .set({
          status: needsMapping ? "needs_mapping" : "ready",
          kind: eventSummary ? "livestock_events" : "spreadsheet",
          rowCount: eventSummary ? eventSummary.inserted : rowCount,
          columns: result.columns,
          mapping: result.suggestedMapping,
          previewRows: eventSummary
            ? [{ eventSummary }]
            : result.previewRows,
        })
        .where(eq(sourceFilesTable.id, fileId));
    }

    // Detect farm type and persist on dataset (only updates if better signal than existing).
    try {
      const detection = result === null ? null : detectFarmType({
        canonicalKeys: Object.values(result.suggestedMapping),
        rawHeaders: result.columns.map((c) => c.header),
        documentText: result.kind === "document" && result.text
          ? result.text.slice(0, 5000)
          : undefined,
      });
      if (detection) {
        // Fetch existing detection to avoid overwriting a high-confidence result.
        const [existing] = await db
          .select({ c: (datasetsTable as any).detectedFocusAreaConfidence })
          .from(datasetsTable)
          .where(eq(datasetsTable.id, file.datasetId));
        const existingConf = (existing?.c as number | null) ?? 0;
        if (detection.confidence >= existingConf) {
          await db
            .update(datasetsTable)
            .set({
              detectedFocusArea: detection.focusArea,
              detectedFocusAreaConfidence: detection.confidence,
              updatedAt: new Date(),
            } as any)
            .where(eq(datasetsTable.id, file.datasetId));
          logger.info(
            { datasetId: file.datasetId, focusArea: detection.focusArea, confidence: detection.confidence },
            "Betriebstyp erkannt",
          );
        }
      }
    } catch (err) {
      logger.warn({ err, fileId }, "Betriebstyp-Erkennung fehlgeschlagen");
    }

    await refreshDatasetStatus(file.datasetId);
    try {
      await evaluateWarnings(file.datasetId, file.userId);
    } catch (err) {
      logger.warn({ err, datasetId: file.datasetId }, "Warnungsauswertung fehlgeschlagen");
    }
    // Automatische Erstanalyse nach erfolgreichem Ingest (nur einmalig pro Dataset).
    try {
      const existingAutoAnalysis = await db
        .select({ id: analysesTable.id })
        .from(analysesTable)
        .where(
          and(
            eq(analysesTable.datasetId, file.datasetId),
            eq((analysesTable as any).templateRef, "auto_erstanalyse")
          ) as any
        )
        .limit(1);

      const alreadyExists = existingAutoAnalysis.length > 0;

      if (!process.env.ANTHROPIC_API_KEY) {
        logger.warn({ datasetId: file.datasetId }, "Automatische Erstanalyse übersprungen: ANTHROPIC_API_KEY nicht gesetzt");
      } else if (!alreadyExists) {
        const isPdfDocument = result?.kind === "document";

        const betriebsspiegelPrompt = isPdfDocument
          ? `Du erstellst jetzt eine automatische Erstanalyse eines hochgeladenen PDF-Dokuments. Gehe strukturiert vor:

1. get_schema — prüfe ob strukturierte Daten vorhanden sind (dokumentAvailable zeigt an, ob ein Dokument verfügbar ist)
2. read_document — lies den vollständigen Dokumenttext
3. Analysiere den Inhalt: Welche Kennzahlen, Zeitreihen und Kategorien sind erkennbar? Welcher Zeitraum wird abgedeckt?
4. Erstelle 2–3 aussagekräftige Grafiken der wichtigsten Kennzahlen mit emit_chart(source='document'):
   - Bei Zeitreihen (z.B. Quartalsverläufe von ECM, Zellzahl, PregRate): chartType='line', xKey='quartal' o.ä.
   - Bei Vergleichen mehrerer Kennzahlen ohne Zeitbezug: chartType='bar'
   - Bei zwei Kennzahlen mit sehr unterschiedlichen Skalen (z.B. kg ECM und Tsd./ml Zellzahl): Doppelachsen-Diagramm mit yAxisId='left'/'right'
   Erstelle nur Grafiken, wenn mindestens 2 Datenpunkte im Dokumenttext vorhanden sind.
5. Vergleiche gefundene Werte mit Richtwerten aus get_master_data, falls relevant.

Fasse am Ende in drei klaren Abschnitten zusammen:
✅ Positive Befunde — was läuft gut oder liegt über dem Richtwert
⚠️ Handlungsbedarf — was liegt unter dem Zielwert oder zeigt Auffälligkeiten
💡 Top-3 Empfehlungen — konkrete nächste Schritte mit Begründung

Schreibe für den Betriebsleiter, nicht für einen Spezialisten. Nenne konkrete Zahlen mit Einheiten.
Falls Zeitreihendaten oder Kennzahlen nicht klar aus dem Dokument extrahierbar sind, erkläre kurz, welche Informationen du gefunden hast und welche nicht.`
          : `Du erstellst jetzt automatisch einen vollständigen Betriebsspiegel. Gehe strukturiert vor:

1. get_schema — welche Kennzahlen sind vorhanden, über welchen Zeitraum, wie viele Datensätze?
2. get_kpis — alle Kern-KPIs berechnen; stelle die 4–6 wichtigsten als Diagramm dar (emit_chart)
3. get_timeseries für die 2–3 relevantesten Kennzahlen (Milchleistung, Zellzahl o.ä.) — Trend der letzten Monate
4. detect_anomalies — gibt es Ausreißer? Welche Tiere oder Zeiträume fallen auf?
5. get_master_data — Richtwerte laden und wichtige KPIs einordnen (besser/schlechter als Ziel?)
6. search_knowledge mit passender Suchanfrage für die auffälligsten Befunde — gibt es Fachinformationen dazu?

Fasse am Ende in drei klaren Abschnitten zusammen:
✅ Läuft gut — was ist in Ordnung oder überdurchschnittlich
⚠️ Handlungsbedarf — was liegt unter dem Zielwert oder zeigt Probleme
💡 Top-3 Empfehlungen — konkrete nächste Schritte mit Begründung

Schreibe für den Betriebsleiter, nicht für einen Spezialisten. Nenne konkrete Zahlen mit Einheiten.`;

        const [analysis] = await db
          .insert(analysesTable)
          .values({
            datasetId: file.datasetId,
            userId: file.userId,
            title: isPdfDocument ? "Dokumentenanalyse" : "Betriebsspiegel",
            category: "overview",
            source: "auto",
            templateRef: "auto_erstanalyse",
            agentProgress: "Wird gestartet…",
          } as any)
          .returning();

        const autoUserId = file.userId;
        const autoAnalysisId = analysis.id;
        setImmediate(async () => {
          try {
            const { checkQuota, incrementQuota, maybeSendQuotaWarning } = await import("./quota");
            const quota = await checkQuota(autoUserId);
            if (!quota.allowed) {
              logger.info({ userId: autoUserId }, "Automatische Erstanalyse übersprungen: Kontingent erschöpft");
              return;
            }
            const result = await processQuestion(analysis, betriebsspiegelPrompt, undefined, { hidden: true });
            if (!result.message.error && result.credits > 0) {
              await incrementQuota(autoUserId, result.credits)
                .then(() => maybeSendQuotaWarning(autoUserId))
                .catch((err) =>
                  logger.error({ err, userId: autoUserId }, "Quota-Increment für Auto-Analyse fehlgeschlagen"),
                );
            }
          } catch (err) {
            logger.warn({ err, analysisId: autoAnalysisId }, "Automatische Erstanalyse fehlgeschlagen");
          }
        });

        logger.info({ analysisId: analysis.id, datasetId: file.datasetId }, "Automatische Erstanalyse gestartet");
      } else {
        logger.info({ datasetId: file.datasetId }, "Automatische Erstanalyse bereits vorhanden — übersprungen");
      }
    } catch (err) {
      logger.warn({ err, datasetId: file.datasetId }, "Automatische Erstanalyse konnte nicht gestartet werden");
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

export async function ingestKnowledgeDoc(docId: string): Promise<void> {
  const [doc] = await db
    .select()
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.id, docId));
  if (!doc) return;

  const startedAt = Date.now();

  try {
    await db
      .update(knowledgeDocumentsTable)
      .set({ status: "processing" })
      .where(eq(knowledgeDocumentsTable.id, docId));

    const buf = await downloadBytes(doc.objectPath);
    let text = "";
    if (doc.fileType === "pptx") {
      text = await extractPptxText(buf);
    } else if (doc.fileType === "docx") {
      text = await extractDocxText(buf);
    } else if (doc.fileType === "excel" || doc.fileType === "csv" || doc.fileType === "tsv") {
      const rows = parseSpreadsheet(buf, doc.filename);
      text = rows.map((row) => row.join("\t")).join("\n");
    } else if (doc.fileType === "txt") {
      text = decodeBuffer(buf);
    } else {
      text = await extractPdfText(buf);
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await db
        .update(knowledgeDocumentsTable)
        .set({ status: "error", errorMessage: "Kein Text extrahierbar" })
        .where(eq(knowledgeDocumentsTable.id, docId));
      return;
    }

    const embeddings = await embedTexts(chunks);

    await db
      .delete(knowledgeChunksTable)
      .where(eq(knowledgeChunksTable.docId, docId));

    const BATCH = 100;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const sliceChunks = chunks.slice(i, i + BATCH);
      const sliceEmbeds = embeddings.slice(i, i + BATCH);
      await db.insert(knowledgeChunksTable).values(
        sliceChunks.map((chunkText, j) => ({
          docId,
          chunkIndex: i + j,
          chunkText,
          embedding: sliceEmbeds[j],
        })),
      );
    }

    await db
      .update(knowledgeDocumentsTable)
      .set({ status: "ready", chunkCount: chunks.length, embeddingModel: LOCAL_MODEL_NAME })
      .where(eq(knowledgeDocumentsTable.id, docId));

    logger.info(
      { docId, chunkCount: chunks.length, durationMs: Date.now() - startedAt, filename: doc.filename },
      "Knowledge-Ingestion erfolgreich abgeschlossen",
    );
  } catch (err) {
    logger.error({ err, docId, durationMs: Date.now() - startedAt }, "Knowledge-Ingestion fehlgeschlagen");
    await db
      .update(knowledgeDocumentsTable)
      .set({
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Unbekannter Fehler",
      })
      .where(eq(knowledgeDocumentsTable.id, docId));
  }
}

export async function refreshDatasetStatus(datasetId: string): Promise<void> {
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

import { createHash } from "node:crypto";
import { parseDateValue } from "./canonical";

export interface EventColumnMapping {
  animalId: number;
  eventType: number;
  eventDate: number;
  dim?: number;
  remark?: number;
  result?: number;
  technician?: number;
  extraCols: { name: string; idx: number }[];
}

export interface ParsedEvent {
  animalId: string;
  eventDate: string;
  eventType: string;
  dim: number | null;
  remark: string | null;
  result: string | null;
  technician: string | null;
  rawExtra: Record<string, string> | null;
  rowHash: string;
}

export interface ParseEventsResult {
  events: ParsedEvent[];
  skippedInvalid: number;
}

const ANIMAL_ID_ALIASES = [
  "id", "stallnummer", "tiernummer", "animal_id", "cowid", "cow_id",
  "animalid", "lom", "ohrmarke", "kuh", "kuhnummer", "stall-nr", "stall nr",
  "tiernr", "tier-nr", "tier nr", "animal", "cow",
];

const EVENT_TYPE_ALIASES = [
  "event", "ereignis", "ereignistyp", "eventtype", "event_type",
  "ereignisart", "typ", "type",
];

const DATE_ALIASES = [
  "date", "datum", "eventdate", "ereignisdatum", "event_date",
  "dat", "datum_ereignis", "event date",
];

const DIM_ALIASES = [
  "dim", "laktationstag", "laktationstage", "dim_days", "days_in_milk",
  "melktage", "tage", "days",
];

const REMARK_ALIASES = [
  "remark", "bemerkung", "note", "notiz", "kommentar", "comment",
  "bull", "bulle", "sire", "stier",
];

const RESULT_ALIASES = [
  "result", "ergebnis", "outcome", "res",
];

const TECHNICIAN_ALIASES = [
  "technician", "techniker", "inseminator", "besamungstechniker",
  "arzt", "vet", "person",
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function matchesAny(header: string, aliases: string[]): boolean {
  const n = normalize(header);
  return aliases.some((a) => normalize(a) === n || n.includes(normalize(a)) || normalize(a).includes(n));
}

export function detectEventColumns(headers: string[]): EventColumnMapping | null {
  let animalIdx = -1;
  let eventIdx = -1;
  let dateIdx = -1;
  let dimIdx = -1;
  let remarkIdx = -1;
  let resultIdx = -1;
  let technicianIdx = -1;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (animalIdx === -1 && matchesAny(h, ANIMAL_ID_ALIASES)) { animalIdx = i; continue; }
    if (eventIdx === -1 && matchesAny(h, EVENT_TYPE_ALIASES)) { eventIdx = i; continue; }
    if (dateIdx === -1 && matchesAny(h, DATE_ALIASES)) { dateIdx = i; continue; }
    if (dimIdx === -1 && matchesAny(h, DIM_ALIASES)) { dimIdx = i; continue; }
    if (remarkIdx === -1 && matchesAny(h, REMARK_ALIASES)) { remarkIdx = i; continue; }
    if (resultIdx === -1 && matchesAny(h, RESULT_ALIASES)) { resultIdx = i; continue; }
    if (technicianIdx === -1 && matchesAny(h, TECHNICIAN_ALIASES)) { technicianIdx = i; continue; }
  }

  const recognized = [animalIdx, eventIdx, dateIdx].filter((i) => i !== -1).length;
  if (recognized < 2) return null;

  const mappedIndices = new Set([animalIdx, eventIdx, dateIdx, dimIdx, remarkIdx, resultIdx, technicianIdx].filter((i) => i !== -1));
  const extraCols = headers
    .map((name, idx) => ({ name, idx }))
    .filter(({ idx }) => !mappedIndices.has(idx));

  return {
    animalId: animalIdx,
    eventType: eventIdx,
    eventDate: dateIdx,
    dim: dimIdx !== -1 ? dimIdx : undefined,
    remark: remarkIdx !== -1 ? remarkIdx : undefined,
    result: resultIdx !== -1 ? resultIdx : undefined,
    technician: technicianIdx !== -1 ? technicianIdx : undefined,
    extraCols,
  };
}

export function parseEventRows(
  rows: string[][],
  headerRowIdx: number,
  mapping: EventColumnMapping,
  datasetId: string,
): ParseEventsResult {
  const events: ParsedEvent[] = [];
  let skippedInvalid = 0;

  const dataRows = rows.slice(headerRowIdx + 1);

  for (const row of dataRows) {
    if (row.every((c) => c.trim() === "")) continue;

    const animalId = mapping.animalId !== undefined ? (row[mapping.animalId] ?? "").trim() : "";
    const rawEventType = mapping.eventType !== undefined ? (row[mapping.eventType] ?? "").trim() : "";
    const rawDate = mapping.eventDate !== undefined ? (row[mapping.eventDate] ?? "").trim() : "";

    if (!animalId || !rawDate) {
      skippedInvalid++;
      continue;
    }

    const eventDate = parseDateValue(rawDate);
    if (!eventDate) {
      skippedInvalid++;
      continue;
    }

    const eventType = rawEventType.toUpperCase() || "UNKNOWN";

    const dimRaw = mapping.dim !== undefined ? (row[mapping.dim] ?? "").trim() : "";
    const dim = dimRaw ? parseInt(dimRaw, 10) : null;
    const dimVal = dim != null && Number.isFinite(dim) ? dim : null;

    const remark = mapping.remark !== undefined ? (row[mapping.remark] ?? "").trim() || null : null;
    const resultRaw = mapping.result !== undefined ? (row[mapping.result] ?? "").trim() : "";
    const result = resultRaw ? resultRaw.slice(0, 4) : null;
    const technician = mapping.technician !== undefined ? (row[mapping.technician] ?? "").trim() || null : null;

    const rawExtra: Record<string, string> = {};
    for (const ec of mapping.extraCols) {
      const val = (row[ec.idx] ?? "").trim();
      if (val) rawExtra[ec.name] = val;
    }

    const hashInput = `${datasetId}|${animalId}|${eventDate}|${eventType}|${remark ?? ""}`;
    const rowHash = createHash("sha256").update(hashInput).digest("hex");

    events.push({
      animalId,
      eventDate,
      eventType,
      dim: dimVal,
      remark,
      result,
      technician,
      rawExtra: Object.keys(rawExtra).length > 0 ? rawExtra : null,
      rowHash,
    });
  }

  return { events, skippedInvalid };
}

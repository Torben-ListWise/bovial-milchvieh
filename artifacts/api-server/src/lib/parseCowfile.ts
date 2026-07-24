// Parser für DairyComp-305 COWFILE1.DAT Datensicherungen (Valley Ag Software).
//
// Format (per Reverse Engineering an einer Referenzdatei verifiziert):
// - Header beginnt mit dem Magic-String "SQLite format 3-V10CowF " — es ist
//   KEIN SQLite, nur ein Tarn-String.
// - Datumsangaben sind uint16 LE: Tage seit 1960-01-01.
// - Item-Verzeichnis (Data Dictionary): 64-Byte-Einträge — char name[5],
//   Padding, 3×uint32 LE (Typ, Byte-Offset im Kuhdatensatz, Breite),
//   deutsche Beschreibung (31 Zeichen) ab Offset 0x1D.
// - Ereignis-Namenstabelle: 32-Byte-Einträge, Eventcode = Index+1.
// - Kuhdatensätze: fixe 12.288 Bytes (0x3000) pro Kuh.
//   - 0x000–0x1FF Stammdaten (Feld-Offsets laut Item-Verzeichnis)
//   - 0x800 ff. Ereignisse, 64 B pro Event (u16 Datum, u8 Code, u8 Protokoll,
//     8 Zeichen Bemerkung)
//   - 0x2800 ff. Laktationszusammenfassungen, 64 B pro Laktation
//     (u8 Laktationsnr., u16 Kalbedatum, u16 Konzeptionsdatum, u16 Trockenstelldatum)
// - Leere Kuh-Slots sind komplett genullt; die Datei ist sparse.

import * as fs from "node:fs";

export const COWFILE_MAGIC = "SQLite format 3-V10CowF ";
const RECORD_SIZE = 0x3000;
const DICT_ENTRY_SIZE = 64;
const EVENT_NAME_ENTRY_SIZE = 32;
const EVENT_LIST_OFFSET = 0x800;
const EVENT_LIST_END = 0x2800;
const EVENT_ENTRY_SIZE = 64;
const LACT_LIST_OFFSET = 0x2800;
const LACT_LIST_END = 0x2c00;
const LACT_ENTRY_SIZE = 64;
const EPOCH_1960_MS = Date.UTC(1960, 0, 1);

export class CowfileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CowfileParseError";
  }
}

export interface CowfileItem {
  name: string;
  type: number;
  offset: number;
  width: number;
  description: string;
}

export interface CowfileCow {
  animalId: string;
  registration: string | null;
  breed: string | null;
  pen: number | null;
  birthDate: string | null; // ISO
  lactationNumber: number | null;
  reproCode: number | null;
  freshDate: string | null;
  conceptionDate: string | null;
  dryDate: string | null;
}

export interface CowfileEvent {
  animalId: string;
  eventDate: string; // ISO
  eventCode: number;
  eventType: string; // Name aus Ereignistabelle oder EVENT_<code>
  protocol: number;
  remark: string | null;
}

export interface CowfileLactation {
  animalId: string;
  lactationNumber: number;
  freshDate: string | null;
  conceptionDate: string | null;
  dryDate: string | null;
}

export interface CowfileParseResult {
  farmName: string | null;
  versionInfo: string | null;
  items: CowfileItem[];
  eventNames: Map<number, string>;
  cows: CowfileCow[];
  events: CowfileEvent[];
  lactations: CowfileLactation[];
  totalSlots: number;
  occupiedSlots: number;
}

export function isCowfileBuffer(head: Buffer): boolean {
  return (
    head.length >= COWFILE_MAGIC.length &&
    head.subarray(0, COWFILE_MAGIC.length).toString("latin1") === COWFILE_MAGIC
  );
}

export function looksLikeCowfileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".dat") && lower.includes("cowfile");
}

function daysToIso(days: number): string | null {
  // Plausibler Bereich: 1965..2050 (Tage seit 1960-01-01)
  if (days < 1826 || days > 33000) return null;
  return new Date(EPOCH_1960_MS + days * 86400000).toISOString().slice(0, 10);
}

function readLatin1(buf: Buffer, off: number, len: number): string {
  let end = off;
  const max = Math.min(off + len, buf.length);
  while (end < max && buf[end] !== 0) end++;
  return buf.subarray(off, end).toString("latin1").trim();
}

function isPrintable(s: string): boolean {
  return /^[\x20-\x7e\xa0-\xff]*$/.test(s);
}

// ---------------------------------------------------------------------------
// Chunked file reader (kein Voll-Load ins RAM)
// ---------------------------------------------------------------------------

class ChunkReader {
  constructor(private fd: number, readonly size: number) {}

  read(offset: number, length: number): Buffer {
    const len = Math.max(0, Math.min(length, this.size - offset));
    const buf = Buffer.alloc(len);
    let done = 0;
    while (done < len) {
      const n = fs.readSync(this.fd, buf, done, len - done, offset + done);
      if (n <= 0) break;
      done += n;
    }
    return buf.subarray(0, done);
  }

  // Sucht ein ASCII-Muster in der Datei (chunked, mit Überlappung).
  findPattern(pattern: Buffer, start = 0, end = this.size): number {
    const CHUNK = 4 * 1024 * 1024;
    const overlap = pattern.length - 1;
    for (let off = start; off < end; off += CHUNK - overlap) {
      const chunk = this.read(off, Math.min(CHUNK, end - off));
      const idx = chunk.indexOf(pattern);
      if (idx !== -1) return off + idx;
      if (off + chunk.length >= end) break;
    }
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Item-Verzeichnis (Data Dictionary)
// ---------------------------------------------------------------------------

function isValidDictEntry(e: Buffer): boolean {
  if (e.length < DICT_ENTRY_SIZE) return false;
  const name = e.subarray(0, 5).toString("latin1");
  if (!/^[A-Z0-9][A-Z0-9%]{0,4}[ ]*$/.test(name.replace(/\x00/g, " "))) return false;
  const type = e.readUInt32LE(8);
  const offset = e.readUInt32LE(12);
  const width = e.readUInt32LE(16);
  if (type > 1000) return false;
  if (offset >= RECORD_SIZE) return false;
  if (width > 512) return false;
  const desc = e.subarray(0x1d, 0x1d + 31).toString("latin1").replace(/\x00/g, " ");
  return isPrintable(desc);
}

function locateItemDirectory(reader: ChunkReader): { start: number; items: CowfileItem[] } {
  // Verlässlicher Anker: der Eintrag "BDAT " mit Beschreibung "Geburtsdatum".
  // Von dort rückwärts/vorwärts in 64-Byte-Schritten laufen, solange die
  // Einträge dem Dictionary-Muster entsprechen.
  let searchFrom = 0;
  let anchor = -1;
  while (anchor === -1) {
    const candidate = reader.findPattern(Buffer.from("BDAT \x00", "latin1"), searchFrom);
    if (candidate === -1) break;
    const entry = reader.read(candidate, DICT_ENTRY_SIZE);
    if (isValidDictEntry(entry)) {
      anchor = candidate;
      break;
    }
    searchFrom = candidate + 1;
  }
  if (anchor === -1) {
    throw new CowfileParseError(
      "Item-Verzeichnis nicht gefunden — die Datei scheint keine gültige COWFILE1.DAT zu sein.",
    );
  }

  // Rückwärts zum Anfang des Verzeichnisses
  let start = anchor;
  while (start - DICT_ENTRY_SIZE >= 0) {
    const prev = reader.read(start - DICT_ENTRY_SIZE, DICT_ENTRY_SIZE);
    if (!isValidDictEntry(prev)) break;
    start -= DICT_ENTRY_SIZE;
  }

  // Vorwärts alle Einträge einsammeln
  const items: CowfileItem[] = [];
  for (let off = start; off + DICT_ENTRY_SIZE <= reader.size; off += DICT_ENTRY_SIZE) {
    const e = reader.read(off, DICT_ENTRY_SIZE);
    if (!isValidDictEntry(e)) break;
    items.push({
      name: e.subarray(0, 5).toString("latin1").replace(/\x00/g, " ").trim(),
      type: e.readUInt32LE(8),
      offset: e.readUInt32LE(12),
      width: e.readUInt32LE(16),
      description: readLatin1(e, 0x1d, 31),
    });
    if (items.length > 2000) break;
  }

  if (items.length < 10) {
    throw new CowfileParseError(
      `Item-Verzeichnis unvollständig (nur ${items.length} Einträge gefunden) — Dateiformat weicht ab.`,
    );
  }
  return { start, items };
}

// ---------------------------------------------------------------------------
// Ereignis-Namenstabelle
// ---------------------------------------------------------------------------

function locateEventNames(reader: ChunkReader, before: number): Map<number, string> {
  // Anker: "BORN" gefolgt von "FRESH" 32 Bytes später.
  let searchFrom = 0;
  let anchor = -1;
  while (anchor === -1) {
    const candidate = reader.findPattern(Buffer.from("BORN", "latin1"), searchFrom, before);
    if (candidate === -1) break;
    const next = reader.read(candidate + EVENT_NAME_ENTRY_SIZE, 5).toString("latin1");
    if (next.startsWith("FRESH")) {
      anchor = candidate;
      break;
    }
    searchFrom = candidate + 1;
  }
  const names = new Map<number, string>();
  if (anchor === -1) {
    // Nicht fatal — Standard-Codes als Fallback
    return names;
  }
  const table = reader.read(anchor, EVENT_NAME_ENTRY_SIZE * 64);
  for (let i = 0; i < 64; i++) {
    const raw = table
      .subarray(i * EVENT_NAME_ENTRY_SIZE, i * EVENT_NAME_ENTRY_SIZE + 12)
      .toString("latin1");
    const m = raw.match(/^[A-Z0-9][A-Z0-9 ]*/);
    const name = m ? m[0].trim() : "";
    if (name.length >= 2) names.set(i + 1, name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Kuhdatensatz-Region
// ---------------------------------------------------------------------------

function looksLikeCowRecord(rec: Buffer, idOff: number, bdatOff: number): boolean {
  if (rec.length < 0x200) return false;
  const id = rec.readUInt32LE(idOff);
  if (id === 0 || id > 10_000_000) return false;
  const bdat = rec.readUInt16LE(bdatOff);
  if (daysToIso(bdat) === null) return false;
  return true;
}

function locateCowRegion(
  reader: ChunkReader,
  dictEnd: number,
  idOff: number,
  bdatOff: number,
): number {
  // Kuh-Region liegt hinter den Verzeichnissen; in 0x1000er-Schritten scannen.
  const STEP = 0x1000;
  const startScan = Math.ceil(dictEnd / STEP) * STEP;
  for (let base = startScan; base + RECORD_SIZE * 4 <= reader.size; base += STEP) {
    const head = reader.read(base, 0x200);
    if (!looksLikeCowRecord(head, idOff, bdatOff)) continue;
    // Verifizieren: mehrere Folge-Slots müssen ebenfalls gültige Kühe
    // oder komplett genullt sein.
    let valid = 1;
    let checked = 1;
    for (let s = 1; s <= 8 && base + (s + 1) * RECORD_SIZE <= reader.size; s++) {
      const r = reader.read(base + s * RECORD_SIZE, 0x200);
      const empty = r.every((b) => b === 0);
      if (empty) continue;
      checked++;
      if (looksLikeCowRecord(r, idOff, bdatOff)) valid++;
    }
    if (valid >= Math.max(2, Math.floor(checked * 0.7))) return base;
  }
  throw new CowfileParseError(
    "Kuhdatensatz-Region nicht gefunden — Dateiformat weicht von der bekannten COWFILE1-Struktur ab.",
  );
}

// ---------------------------------------------------------------------------
// Betriebsname / Versionsinfo
// ---------------------------------------------------------------------------

function extractHeaderMeta(reader: ChunkReader): { farmName: string | null; versionInfo: string | null } {
  const head = reader.read(0, 0x4000);
  let versionInfo: string | null = null;
  const basisIdx = head.indexOf(Buffer.from("BASIS ", "latin1"));
  if (basisIdx !== -1) {
    versionInfo = readLatin1(head, basisIdx, 14) || null;
  }
  // Betriebsname: längster druckbarer String (>= 6 Zeichen, enthält Buchstaben)
  // im Bereich um 0x3000–0x3200, mit Padding aus Leerzeichen.
  let farmName: string | null = null;
  const region = head.subarray(0x3000, 0x3400);
  const text = region.toString("latin1");
  const candidates = text.match(/[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß()\-.,&/ ]{5,40}/g) ?? [];
  const blocked = /BASIS|SQLite|CowF|vices|sf \d/;
  let bestLen = 0;
  for (const c of candidates) {
    const t = c.trim();
    if (blocked.test(t)) continue;
    if (!/[A-Za-zÄÖÜäöüß]{3}/.test(t)) continue;
    if (t.length > bestLen) {
      bestLen = t.length;
      farmName = t;
    }
  }
  return { farmName, versionInfo };
}

// ---------------------------------------------------------------------------
// Hauptparser
// ---------------------------------------------------------------------------

export function parseCowfile(filePath: string): CowfileParseResult {
  const fd = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 0x10000) {
      throw new CowfileParseError("Datei zu klein für eine COWFILE1.DAT-Sicherung.");
    }
    const reader = new ChunkReader(fd, size);

    const head = reader.read(0, COWFILE_MAGIC.length);
    if (!isCowfileBuffer(head)) {
      throw new CowfileParseError(
        "Kein gültiges DairyComp-COWFILE1-Format (Magic-String fehlt).",
      );
    }

    const { farmName, versionInfo } = extractHeaderMeta(reader);
    const { start: dictStart, items } = locateItemDirectory(reader);
    const dictEnd = dictStart + items.length * DICT_ENTRY_SIZE;
    const eventNames = locateEventNames(reader, dictStart);

    const itemMap = new Map(items.map((i) => [i.name, i]));
    const idItem = itemMap.get("ID");
    const bdatItem = itemMap.get("BDAT");
    if (!idItem || !bdatItem) {
      throw new CowfileParseError(
        "Pflichtfelder ID/BDAT fehlen im Item-Verzeichnis — Import abgebrochen.",
      );
    }
    const penOff = itemMap.get("PEN")?.offset;
    const lactOff = itemMap.get("LACT")?.offset;
    const rcOff = itemMap.get("RC")?.offset;
    const regItem = itemMap.get("REG1") ?? itemMap.get("REG");
    const fdatOff = itemMap.get("FDAT")?.offset;
    const cdatOff = itemMap.get("CDAT")?.offset;
    const ddatOff = itemMap.get("DDAT")?.offset;

    const cowBase = locateCowRegion(reader, dictEnd, idItem.offset, bdatItem.offset);

    const cows: CowfileCow[] = [];
    const events: CowfileEvent[] = [];
    const lactations: CowfileLactation[] = [];
    let totalSlots = 0;
    let occupiedSlots = 0;

    for (let off = cowBase; off + RECORD_SIZE <= size; off += RECORD_SIZE) {
      totalSlots++;
      const rec = reader.read(off, RECORD_SIZE);
      const id = rec.readUInt32LE(idItem.offset);
      if (id === 0) continue; // leerer Slot
      const birthDate = daysToIso(rec.readUInt16LE(bdatItem.offset));
      if (birthDate === null) continue; // kein plausibler Kuhdatensatz
      occupiedSlots++;
      const animalId = String(id);

      const breed = readLatin1(rec, 0x100, 8) || null;
      // Registriernummer nur übernehmen, wenn sie wie ein lesbarer String aussieht
      // (das Feld enthält je nach Betrieb auch Binärdaten).
      let registration: string | null = null;
      if (regItem) {
        const raw = readLatin1(rec, regItem.offset, Math.max(regItem.width, 1));
        if (raw.length >= 4 && /^[A-Za-z0-9 .\-/]+$/.test(raw)) registration = raw;
      }
      cows.push({
        animalId,
        registration,
        breed: breed && isPrintable(breed) ? breed : null,
        pen: penOff !== undefined ? rec.readUInt16LE(penOff) : null,
        birthDate,
        lactationNumber: lactOff !== undefined ? rec[lactOff] : null,
        reproCode: rcOff !== undefined ? rec[rcOff] : null,
        freshDate: fdatOff !== undefined ? daysToIso(rec.readUInt16LE(fdatOff)) : null,
        conceptionDate: cdatOff !== undefined ? daysToIso(rec.readUInt16LE(cdatOff)) : null,
        dryDate: ddatOff !== undefined ? daysToIso(rec.readUInt16LE(ddatOff)) : null,
      });

      // Ereignisse
      for (let eo = EVENT_LIST_OFFSET; eo + EVENT_ENTRY_SIZE <= EVENT_LIST_END; eo += EVENT_ENTRY_SIZE) {
        const dateDays = rec.readUInt16LE(eo);
        if (dateDays === 0) break;
        const eventDate = daysToIso(dateDays);
        if (!eventDate) continue;
        const code = rec[eo + 2];
        if (code === 0) continue;
        const name = eventNames.get(code) ?? DEFAULT_EVENT_NAMES[code] ?? `EVENT_${code}`;
        const remark = readLatin1(rec, eo + 4, 8) || null;
        events.push({
          animalId,
          eventDate,
          eventCode: code,
          eventType: name,
          protocol: rec[eo + 3],
          remark: remark && isPrintable(remark) ? remark : null,
        });
      }

      // Laktationszusammenfassungen
      for (let lo = LACT_LIST_OFFSET; lo + LACT_ENTRY_SIZE <= LACT_LIST_END; lo += LACT_ENTRY_SIZE) {
        const lactNo = rec[lo];
        if (lactNo === 0 || lactNo > 30) break;
        const freshDate = daysToIso(rec.readUInt16LE(lo + 1));
        if (!freshDate) continue;
        lactations.push({
          animalId,
          lactationNumber: lactNo,
          freshDate,
          conceptionDate: daysToIso(rec.readUInt16LE(lo + 3)),
          dryDate: daysToIso(rec.readUInt16LE(lo + 5)),
        });
      }
    }

    if (occupiedSlots === 0) {
      throw new CowfileParseError(
        "Keine Kuhdatensätze in der Datei gefunden — Import abgebrochen.",
      );
    }

    return {
      farmName,
      versionInfo,
      items,
      eventNames,
      cows,
      events,
      lactations,
      totalSlots,
      occupiedSlots,
    };
  } finally {
    fs.closeSync(fd);
  }
}

// Standard-Eventcodes von DairyComp 305 (Fallback, falls Namenstabelle fehlt)
const DEFAULT_EVENT_NAMES: Record<number, string> = {
  1: "BORN",
  2: "FRESH",
  5: "HEAT",
  6: "BRED",
  7: "PREG",
  8: "OPEN",
  12: "DRY",
  15: "SOLD",
  16: "DIED",
};

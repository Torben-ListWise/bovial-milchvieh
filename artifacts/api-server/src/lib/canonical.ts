// Canonical dairy data model. The deterministic compute layer operates only on
// these canonical fields. Ingestion maps arbitrary source columns onto them.

export type CanonicalFieldType = "number" | "date" | "string";

export interface CanonicalField {
  key: string;
  label: string; // German label
  type: CanonicalFieldType;
  unit?: string;
  aliases: string[]; // lowercased source-header fragments (German + common exports)
}

export const CANONICAL_FIELDS: CanonicalField[] = [
  {
    key: "date",
    label: "Datum",
    type: "date",
    aliases: [
      "datum",
      "date",
      "pruefdatum",
      "prüfdatum",
      "probedatum",
      "messdatum",
      "kontrolldatum",
      "mlp datum",
      "tag",
      "monat",
    ],
  },
  {
    key: "animal_id",
    label: "Tiernummer",
    type: "string",
    aliases: [
      "tiernummer",
      "tier-nr",
      "tier nr",
      "tiernr",
      "ohrmarke",
      "lom",
      "kuh",
      "kuhnummer",
      "stallnummer",
      "stall-nr",
      "animal",
      "cow",
      "id",
    ],
  },
  {
    key: "lactation_number",
    label: "Laktationsnummer",
    type: "number",
    aliases: ["laktation", "laktationsnummer", "lakt", "lakt.", "lactation", "kalbung nr"],
  },
  {
    key: "days_in_milk",
    label: "Laktationstag",
    type: "number",
    unit: "Tage",
    aliases: ["laktationstag", "melktage", "dim", "days in milk", "laktationstage", "tage"],
  },
  {
    key: "milk_yield_kg",
    label: "Milchmenge",
    type: "number",
    unit: "kg",
    aliases: [
      "milchmenge",
      "milch kg",
      "milch (kg)",
      "milchleistung",
      "milkkg",
      "milk kg",
      "milk yield",
      "kg milch",
      "tagesgemelk",
      "milch",
      "m-kg",
      "mkg",
    ],
  },
  {
    key: "fat_pct",
    label: "Fettgehalt",
    type: "number",
    unit: "%",
    aliases: ["fett", "fett %", "fett%", "fettgehalt", "fat", "fat %", "f %", "f%"],
  },
  {
    key: "protein_pct",
    label: "Eiweißgehalt",
    type: "number",
    unit: "%",
    aliases: [
      "eiweiss",
      "eiweiß",
      "eiweiss %",
      "eiweiß%",
      "eiweissgehalt",
      "protein",
      "protein %",
      "e %",
      "e%",
    ],
  },
  {
    key: "lactose_pct",
    label: "Laktose",
    type: "number",
    unit: "%",
    aliases: ["laktose", "lactose", "laktose %"],
  },
  {
    key: "scc",
    label: "Zellzahl",
    type: "number",
    unit: "Tsd/ml",
    aliases: [
      "zellzahl",
      "zellgehalt",
      "zz",
      "scc",
      "somatic cell",
      "somatische zellen",
      "zellzahl tsd",
    ],
  },
  {
    key: "urea",
    label: "Harnstoff",
    type: "number",
    unit: "mg/l",
    aliases: ["harnstoff", "urea", "harnstoffgehalt", "mun"],
  },
  {
    key: "body_weight_kg",
    label: "Körpergewicht",
    type: "number",
    unit: "kg",
    aliases: ["gewicht", "körpergewicht", "koerpergewicht", "lebendgewicht", "body weight", "lw"],
  },
  {
    key: "feed_intake_kg",
    label: "Futteraufnahme",
    type: "number",
    unit: "kg TM",
    aliases: ["futteraufnahme", "futter", "tm-aufnahme", "feed intake", "dmi", "trockenmasse"],
  },
  {
    key: "milking_count",
    label: "Melkungen",
    type: "number",
    aliases: ["melkungen", "anzahl melkungen", "milkings", "gemelke"],
  },
];

export const CANONICAL_FIELD_MAP: Record<string, CanonicalField> =
  Object.fromEntries(CANONICAL_FIELDS.map((f) => [f.key, f]));

function normalizeHeader(header: string): string {
  return header
    .toString()
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Suggest a canonical field for a source column header. Returns key + confidence.
export function suggestCanonicalField(
  header: string,
): { key: string; confidence: number } | null {
  const norm = normalizeHeader(header);
  if (!norm) return null;

  let best: { key: string; confidence: number } | null = null;
  for (const field of CANONICAL_FIELDS) {
    for (const alias of field.aliases) {
      let score = 0;
      if (norm === alias) score = 1;
      else if (norm.replace(/[^a-z0-9]/g, "") === alias.replace(/[^a-z0-9]/g, ""))
        score = 0.95;
      else if (norm.startsWith(alias) || alias.startsWith(norm)) score = 0.8;
      else if (norm.includes(alias)) score = 0.7;
      if (score > 0 && (!best || score > best.confidence)) {
        best = { key: field.key, confidence: score };
      }
    }
  }
  if (best && best.confidence >= 0.7) return best;
  return null;
}

// Parse a German-formatted numeric value: "1.234,56" -> 1234.56, "12,3" -> 12.3.
export function parseGermanNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = raw.toString().trim();
  if (!s) return null;
  s = s.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // German: dot = thousands, comma = decimal.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Parse a date from common German/export formats. Returns ISO yyyy-mm-dd or null.
export function parseDateValue(raw: unknown): string | null {
  if (raw == null) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "number") {
    // Excel serial date (days since 1899-12-30).
    if (raw > 20000 && raw < 60000) {
      const ms = Math.round((raw - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const s = raw.toString().trim();
  if (!s) return null;

  // dd.mm.yyyy or dd.mm.yy or dd/mm/yyyy
  let m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    let year = parseInt(yy, 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    const month = parseInt(mm, 10);
    const day = parseInt(dd, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year.toString().padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
  }
  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mm, dd] = m;
    return `${y}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function parseCanonicalValue(
  fieldKey: string,
  raw: unknown,
): number | string | null {
  const field = CANONICAL_FIELD_MAP[fieldKey];
  if (!field) return null;
  if (field.type === "number") return parseGermanNumber(raw);
  if (field.type === "date") return parseDateValue(raw);
  const s = raw == null ? "" : raw.toString().trim();
  return s || null;
}

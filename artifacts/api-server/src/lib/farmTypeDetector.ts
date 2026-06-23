export interface FarmTypeDetectionResult {
  focusArea: string;
  confidence: number; // 0.0 – 1.0
  method: "columns" | "text" | "combined";
}

// Canonical field keys that are strongly associated with each farm type.
const COLUMN_SIGNALS: Record<string, string[]> = {
  milchvieh: [
    "milk_yield_kg",
    "scc",
    "fat_pct",
    "protein_pct",
    "lactation_number",
    "days_in_milk",
    "urea",
    "milking_count",
    "lactose_pct",
  ],
  // No canonical fields yet for the types below – text signals are used instead.
  schweine: [],
  geflügel: [],
  ackerbau: [],
  biogas: [],
};

// Column-header fragments (lowercased) associated with each farm type.
// Checked against raw header names when no canonical match is available.
const HEADER_SIGNALS: Record<string, string[]> = {
  milchvieh: [
    "milch", "kuh", "kühe", "laktation", "eutergesundheit", "zellzahl", "scc",
    "fett%", "eiweiß%", "tagesgemelk", "mlp",
  ],
  schweine: [
    "tageszunahme", "mfa", "muskelfleisch", "ferkel", "sau", "sauen",
    "mastgruppe", "umrauschrate", "abferkelrate", "schlachtgewicht",
  ],
  geflügel: [
    "legehenne", "legehennen", "broiler", "pute", "puten", "mastgeflügel",
    "eier", "legeleistung",
  ],
  ackerbau: [
    "dt/ha", "ertrag", "ernte", "fruchtfolge", "kultur", "fläche",
    "weizen", "raps", "mais", "gerste",
  ],
  biogas: [
    "gasproduktion", "methangehalt", "substrat", "bhkw", "fermenter",
    "gasmenge", "methan",
  ],
};

// Document text keywords (lowercased) associated with each farm type.
const TEXT_KEYWORDS: Record<string, string[]> = {
  milchvieh: [
    "milchkuh", "milchkühe", "herde", "laktation", "eutergesundheit",
    "zellzahl", "scc", "milchleistung", "tagesgemelk", "mlp-ergebnis",
    "fettgehalt", "eiweißgehalt", "harnstoff",
  ],
  schweine: [
    "schwein", "schweine", "ferkel", "sau", "sauen", "mastgruppe",
    "tageszunahme", "umrauschrate", "abferkelrate", "mfa",
    "muskelfleischanteil", "mastdurchgang",
  ],
  geflügel: [
    "geflügel", "legehenne", "legehennen", "broiler", "pute", "puten",
    "mastgeflügel", "legeleistung", "eierproduktion",
  ],
  ackerbau: [
    "ackerbau", "fruchtfolge", "weizen", "raps", "mais", "gerste",
    "dt/ha", "ernte", "feldkultur", "pflanzenschutz", "düngemittel",
  ],
  biogas: [
    "biogas", "methangehalt", "gasproduktion", "substrat", "bhkw",
    "biogasanlage", "fermenter", "nawaro",
  ],
};

function scoreByColumns(canonicalKeys: string[]): Record<string, number> {
  const keySet = new Set(canonicalKeys);
  const scores: Record<string, number> = {};
  for (const [type, signals] of Object.entries(COLUMN_SIGNALS)) {
    const matched = signals.filter((s) => keySet.has(s)).length;
    scores[type] = signals.length > 0 ? matched / signals.length : 0;
  }
  return scores;
}

function scoreByHeaders(headers: string[]): Record<string, number> {
  const normalizedHeaders = headers.map((h) =>
    h.toLowerCase().replace(/\s+/g, ""),
  );
  const scores: Record<string, number> = {};
  for (const [type, signals] of Object.entries(HEADER_SIGNALS)) {
    let matched = 0;
    for (const signal of signals) {
      const norm = signal.replace(/\s+/g, "");
      if (normalizedHeaders.some((h) => h.includes(norm))) matched++;
    }
    scores[type] = signals.length > 0 ? matched / signals.length : 0;
  }
  return scores;
}

function scoreByText(text: string): Record<string, number> {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};
  for (const [type, keywords] of Object.entries(TEXT_KEYWORDS)) {
    const matched = keywords.filter((kw) => lower.includes(kw)).length;
    scores[type] = matched / keywords.length;
  }
  return scores;
}

function pickBest(scores: Record<string, number>): { type: string; score: number } {
  let best = { type: "sonstiges", score: 0 };
  for (const [type, score] of Object.entries(scores)) {
    if (score > best.score) {
      best = { type, score };
    }
  }
  return best;
}

export interface DetectInput {
  canonicalKeys?: string[];
  rawHeaders?: string[];
  documentText?: string;
}

export function detectFarmType(input: DetectInput): FarmTypeDetectionResult | null {
  const hasColumns =
    (input.canonicalKeys?.length ?? 0) > 0 ||
    (input.rawHeaders?.length ?? 0) > 0;
  const hasText = (input.documentText?.length ?? 0) > 0;

  if (!hasColumns && !hasText) return null;

  const TYPES = Object.keys(COLUMN_SIGNALS);
  const combined: Record<string, number> = Object.fromEntries(
    TYPES.map((t) => [t, 0]),
  );

  let method: FarmTypeDetectionResult["method"] = "text";

  if (hasColumns) {
    method = hasText ? "combined" : "columns";
    const colScores = scoreByColumns(input.canonicalKeys ?? []);
    const hdrScores = scoreByHeaders(input.rawHeaders ?? []);
    for (const t of TYPES) {
      // canonical fields are a stronger signal
      combined[t] += (colScores[t] ?? 0) * 2;
      combined[t] += hdrScores[t] ?? 0;
    }
  }

  if (hasText) {
    const textScores = scoreByText(input.documentText!);
    for (const t of TYPES) {
      combined[t] += textScores[t] ?? 0;
    }
  }

  const best = pickBest(combined);

  // Require at least a minimal signal before returning a suggestion.
  // Column-based threshold is lower because canonical fields are very precise.
  const MIN_SCORE = hasColumns ? 0.1 : 0.15;
  if (best.score < MIN_SCORE) return null;

  // Normalize confidence to a 0-1 scale.
  const maxPossible = hasColumns ? (hasText ? 3 : 2) : 1;
  const confidence = Math.min(best.score / maxPossible, 1);

  return { focusArea: best.type, confidence, method };
}

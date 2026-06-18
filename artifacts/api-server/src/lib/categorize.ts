// Lightweight, deterministic categorization of analysis questions into German
// dairy analysis categories. Used for analysis tagging and operator monitoring
// (metadata only — never customer values).

const CATEGORY_KEYWORDS: { category: string; keywords: string[] }[] = [
  {
    category: "Eutergesundheit",
    keywords: ["zellzahl", "euter", "mastitis", "scc", "zellgehalt"],
  },
  {
    category: "Milchleistung",
    keywords: ["milch", "leistung", "menge", "kg", "ertrag", "milchmenge"],
  },
  {
    category: "Inhaltsstoffe",
    keywords: ["fett", "eiweiss", "eiweiß", "protein", "laktose", "inhaltsstoff"],
  },
  {
    category: "Fütterung",
    keywords: ["futter", "harnstoff", "ration", "tm", "trockenmasse", "fütterung"],
  },
  {
    category: "Fruchtbarkeit",
    keywords: ["laktation", "kalbung", "besamung", "trächtig", "fruchtbarkeit", "zwischenkalbe"],
  },
  {
    category: "Tiergesundheit",
    keywords: ["gesundheit", "krank", "gewicht", "kondition", "lahm"],
  },
];

export function categorizeQuestion(text: string): string {
  const lower = text.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return "Allgemein";
}

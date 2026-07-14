/**
 * One-shot script: embeds DairyComp KPI synonym entries and inserts them
 * as knowledge_chunks on the existing DairyComp glossar document.
 * Run once: pnpm --filter @workspace/api-server exec tsx scripts/seed-dairycomp-synonyms.ts
 */
import { pipeline, env } from "@huggingface/transformers";
import { fileURLToPath } from "url";
import path from "path";
import pg from "pg";

const DOC_ID = "cff9bd89-d4f6-42dc-b721-af094e487fe6";
const START_INDEX = 81; // next after existing 81 chunks (0-80)

// ── Point at the same HF cache the server uses ──────────────────────────────
const HF_CACHE_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  ".hf-cache",
);
env.cacheDir = HF_CACHE_DIR;
env.localModelPath = HF_CACHE_DIR;
env.allowRemoteModels = false;

// ── Synonym entries — each maps natural-language user terms → DC command ─────
//
// Format for each entry:
//   Line 1: Natural language synonyms (German + English), comma/slash separated
//   Line 2: DairyComp-Befehl + short explanation
//
// These chunks are picked up by:
//   a) Keyword search: ILIKE '%token%' on chunk_text
//   b) Semantic vector search (cosine similarity)
//
const SYNONYM_ENTRIES: string[] = [
  // ── Reproduction / Fertilität ─────────────────────────────────────────────
  [
    "Pregnancy Rate, Trächtigkeitsrate, Trächtigkeits-Rate, Konzeptionsrate, 21-Tage-Trächtigkeitsrate, 21-day pregnancy rate, pregrate, preg rate, Fruchtbarkeit, Reproduktionsrate, Besamungserfolg, Befruchtungsrate",
    "DairyComp-Befehl: BREDSUM\\E — zeigt Pregnancy Rate (Trächtigkeitsrate) nach Laktationsgruppe über alle Laktationen. Alternativ BRDCLG für Besamungsübersicht nach Laktationsgruppe (BREDSUM FOR LACT>0 BY LCTGP\\B BRDCLG).",
  ].join("\n"),

  [
    "Conception Rate, Besamungsrate, Besamungserfolg, Erstbesamungserfolg, CR21, Brunsterkennung Rate, heat detection rate, AI success rate, Trächtigkeitsrate erste Besamung",
    "DairyComp-Befehl: BREDSUM — zeigt Besamungsübersicht mit Conception Rate und Pregnancy Rate. BRDCLG für detaillierte Besamungsauswertung nach Laktationsgruppe.",
  ].join("\n"),

  [
    "Besamung, Besamungsliste, Erstbesamung, Besamungsprotokoll, AI, artificial insemination, insemination, Stiereinsatz, Besamungskalender",
    "DairyComp-Befehl: BRED — Besamungseingabe. EC=5 EDAY FOR 5STEL=%OHRNUMMER\\B BRED1 für einzelne Tiere. BRDCLG für Übersicht.",
  ].join("\n"),

  [
    "Trächtigkeitsuntersuchung, TU, TU-Liste, TU-Ergebnisse, pregnancy check, Ultraschall TU, Trächtigkeitskontrolle, TU positiv, TU negativ, Trächtigkeitsbefund",
    "DairyComp-Befehl: VLIST — TU-Liste Kühe (kombiniert CLRVETC!VETLIST VITEMS für Kühe). VLISTH für Färsen. VENTERV für Eingabe TU-Ergebnisse. VLIST2 für 2. TU-Kontrolle.",
  ].join("\n"),

  [
    "Ovsynch, Synchronisation, Hormonprogramm, GnRH, PG, Prostaglandin, OVS, Double-OVS, Resynchronisation, Resynch, Brunstsynchronisation",
    "DairyComp-Befehle: ZOVMO (Ovsynch Montag), ZOVDI (Ovsynch Dienstag), ZOVFR (Ovsynch Freitag), ZOVMI (Ovsynch Mittwoch), TOT2OVS (Freitag Double-OVS). SYNCCLR!LIST TRTITMS für aktive Synchronisationstiere.",
  ].join("\n"),

  // ── Zellzahl / Mastitis ───────────────────────────────────────────────────
  [
    "Zellzahl, SCC, Somatic Cell Count, somatische Zellzahl, Mastitisrate, Mastitis-Rate, Eutergesundheit, Zellzahlverlauf, Zellzahl-Entwicklung, Zellzahl-Trend, hohe Zellzahl, Zellzahlanstieg",
    "DairyComp-Befehl: YRAVG4 — Zellzahl-Jahresübersicht (PLOT SCC FOR LACT>0 BY LCTGP\\R). SCC-Wert je Tier im Tagesbericht. ZZCON für hohe Zellzahlen (SCC>300 DCC>231 INMILK). ZZ500 für SCC>400.",
  ].join("\n"),

  [
    "Mastitis, Euterkrankheit, Mastitis-Liste, Mastitistiere, klinische Mastitis, subklinische Mastitis, Euterentzündung, Mastitisbehandlung",
    "DairyComp-Befehl: EG — EUTER KRANKEN, Liste euterkranker Tiere (Gruppen 20/23). ZZ500/ZZCON für Zellzahl-Grenzwerte. CMALERT für Krankheitsalarm via CM-Sensor.",
  ].join("\n"),

  // ── Milchleistung ─────────────────────────────────────────────────────────
  [
    "Milchleistung, Milchmenge, Tagesmilchmenge, Milchertrag, Milch-Performance, milk production, milk yield, ECM, Energiekorrigierte Milch, 305-Tage-Leistung, 305ME, Jahresleistung",
    "DairyComp-Befehl: YRAVG1 — jährliche Milchleistung (PLOT MILK FOR LACT>0 BY LCTGP\\R). YRAVG2 — 305ME-Leistung. DMILCH — Tagesmilch nach Gruppe. ALARMCND/ALRMCND für tägliche Abweichungen.",
  ].join("\n"),

  [
    "Milchabfall, Milcheinbruch, Milchrückgang, Milchverlust, Leistungsabfall, Milch-Differenz, milk drop, DMLK, Milchmengenabweichung, Tagesabweichung",
    "DairyComp-Befehl: WOCHDIF — Wöchentliche Milchdifferenz (SHOW ID WMLK1 WMLK2 WDIFF DIM PEN DCC RELV FOR WDIFF<-5). ALRMCND für tägliche Abweichungen >8 Liter. WENIG für Kühe mit Wmlk1<15.",
  ].join("\n"),

  // ── Abgänge / Remontierung ────────────────────────────────────────────────
  [
    "Abgänge, Remontierung, Abgangsrate, Culling Rate, Culling, Merzung, Abgangsgründe, Nutzungsdauer, Verbleiberate, Stayability, tote Tiere, Verendungen, Verkauf",
    "DairyComp-Befehl: ABGANGF — Abgänge Jungrinder (ABGANGF!EGRAPH SOLD FOR INT<>8 BY AGE\\Y). FABGANG für alle Färsenabgänge. AVREPRO SUM BY RPRO LCTGP für Reproduktionsübersicht.",
  ].join("\n"),

  [
    "Verendung, verendet, gestorben, Tierverluste, DIED, Mortalität, Mortalitätsrate, mortality rate, dead cows",
    "DairyComp-Befehl: DIED — EVENTS FRESH SOLD DIED (Abgangsereignisse). MAKDI=X für markierte tote Tiere. Abgangscode im EVENTS-Bericht.",
  ].join("\n"),

  // ── Trockenstellen / Trockensteher ────────────────────────────────────────
  [
    "Trockenstellen, Trockensteher, Dry-off, Dry cows, Trockenstehzeit, Trockenstehperiode, trockengestellte Kühe, Trockensteller-Liste, Trockenstehmanagement",
    "DairyComp-Befehl: DRYLIST — alle Trockensteher (SHOW ID 5STEL PEN LSIR DDAT DDRY DUE FOR DDAT>0 BY PEN DUE). TROCK1 für trockenzustellende Kühe (DCC=225-280). DRCON für Trockenstell-Bedingungen.",
  ].join("\n"),

  [
    "Abkalbeliste, Abkalbungen, Abkalbetermine, Kalbung, Due date, Calvings, Freshening, frisch abgekalbt, Frischkühe, Fresh cow, Kalbetermin",
    "DairyComp-Befehl: FCLIST — Fresh Cow List (SHOW PEN ID 5STEL LACT DIM DMLK1 DMLK2 WMLK1 EXPDM MDEV FOR PEN=3). CLFTAB für Abkalbungen gesamt (EVENTS\\3). ABKMOG für Abkalbungen pro Monat gesamt.",
  ].join("\n"),

  // ── Reproduktions-Kennzahlen allgemein ───────────────────────────────────
  [
    "Brunst, Brunsterkennung, Brunstbeobachtung, Heat detection, Brunstalarm, Aktivitätssensor, Brunstliste, Wärme, Östrus, estrus detection",
    "DairyComp-Befehl: CMHEATS — CM-Brunstalarm (LIST ID PEN DIM DSLH RPRO ACDAT:5 ACTIM ACLEV GAP FOR CMHCOND BY PEN). CMHCOND als Bedingung für aktive Brunsttiere.",
  ].join("\n"),

  [
    "Wartezeit, Voluntary Waiting Period, VWP, days open, offene Tage, Rastzeit, erste Besamung nach Kalbung, days to first service",
    "DairyComp-Befehl: DAYOPEN — Kühe 140 Tage in Milch und nicht tragend (SHOW ID DIM DCC TBRD FOR DIM>140 RC=1-3 RC<>1 LACT>0). DAYOPN für TU-negative Tiere.",
  ].join("\n"),

  [
    "Zwischenkalbezeit, ZKZ, inter-calving interval, calving interval, Geburtenabstand, Reproduktionseffizienz",
    "DairyComp-Befehl: AVREPRO — Reproduktionsübersicht (AVREPRO SUM BY RPRO LCTGP FOR LACT>0 RC>0). BREDSUM\\E für Pregnancy Rate. Zwischenkalbezeit errechnet sich aus DIM + Trächtigkeitsdauer.",
  ].join("\n"),

  // ── Gesundheit ────────────────────────────────────────────────────────────
  [
    "Lahmheit, lahme Kühe, Locomotion Score, Klauenpflege, Klauenkrankheit, Klauenprobleme, lameness, hoof health, Mortellaro, Klauenrehe",
    "DairyComp: Lahmheitsdaten werden über EVENTS (Ereigniscodes) erfasst. Behandlungslistung über BEHANDS oder BEHAND. Keine eigene Lahmheits-Standardabkürzung in ALTER3 vorhanden — bitte betriebsspezifische Kürzel prüfen.",
  ].join("\n"),

  [
    "BCS, Body Condition Score, Körperkondition, Konditionsbeurteilung, Körperkonditionsnote, Fetteinlagerung, Konditionsverlust",
    "DairyComp-Befehl: BCSU — BCS-Übernahme alle Zeitpunkte (BCSD15!BCSD30!BCSD60!BCSD120!BCSD200!BCSD300!BCSD400). BC120, BCS30 etc. für einzelne Zeitpunkte. BCSV für aktuellen BCS-Wert.",
  ].join("\n"),

  // ── Stalllisten / Gruppen ─────────────────────────────────────────────────
  [
    "Tierliste, Herdenübersicht, Bestandsliste, Stallbelegung, Gruppenübersicht, Stall, Pen, Gruppe, Herdenmanagement, cow list, herd list",
    "DairyComp-Befehl: COWSUM — Adult summary by pen & repro (SUM FOR LACT>0 BY PEN RC). ALLEK für alle Kühe in Milch. COWLIST für Tiere nach Laktationsgruppe. VITEMS für Tierdetails.",
  ].join("\n"),

  [
    "Bestandsbuch, Stallbuch, Herdenbuch, inventory, herd inventory, Tierbestand, Bestand",
    "DairyComp-Befehl: BEH1/BEH4 — Bestandsbuch (SHOW PEN ID DIM SDESC VETC DMLK1 MDEV REM für jeweiligen Stall). HITAE-basierte Filterung nach Stallnummer.",
  ].join("\n"),
];

// ── DB connection ─────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log("Lade Embedding-Modell...");
  const embedPipeline = await pipeline("feature-extraction", "Xenova/multilingual-e5-base", {
    dtype: "fp32",
  });
  console.log("Modell geladen.");

  // Check for existing synonym chunks (idempotency: skip if already present)
  const existing = await pool.query(
    "SELECT chunk_index FROM knowledge_chunks WHERE doc_id = $1 AND chunk_index >= $2",
    [DOC_ID, START_INDEX],
  );
  if (existing.rows.length > 0) {
    console.log(`⚠️  ${existing.rows.length} Synonym-Chunks bereits vorhanden (ab Index ${START_INDEX}). Skipping.`);
    await pool.end();
    return;
  }

  for (let i = 0; i < SYNONYM_ENTRIES.length; i++) {
    const text = SYNONYM_ENTRIES[i];
    const chunkIndex = START_INDEX + i;

    // "passage: " prefix — same as embedTexts() in embeddings.ts
    const output = await embedPipeline(`passage: ${text}`, { pooling: "mean", normalize: true });
    const vec: number[] = Array.from(output.data as Float32Array);
    const vecStr = `[${vec.join(",")}]`;

    await pool.query(
      `INSERT INTO knowledge_chunks (doc_id, chunk_index, chunk_text, embedding)
       VALUES ($1, $2, $3, $4::vector)`,
      [DOC_ID, chunkIndex, text, vecStr],
    );
    console.log(`  ✓ Chunk ${chunkIndex} eingefügt (${text.slice(0, 60).replace(/\n/g, " ")}…)`);
  }

  await pool.end();
  console.log(`\n✅ ${SYNONYM_ENTRIES.length} Synonym-Chunks erfolgreich eingefügt.`);
}

main().catch((err) => {
  console.error("Fehler:", err);
  process.exit(1);
});

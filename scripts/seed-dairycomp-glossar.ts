/**
 * Inserts the DairyComp 305 command glossary into the knowledge library.
 * Run once: pnpm --filter @workspace/api-server exec tsx ../../scripts/seed-dairycomp-glossar.ts
 *
 * Each row becomes one chunk (no embedding needed — matched via ILIKE keyword search).
 * Re-running is idempotent: existing doc+chunks are deleted first.
 */
import "dotenv/config";
import { db, knowledgeDocumentsTable, knowledgeChunksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const GLOSSAR_TITLE = "DairyComp 305 Befehlsglossar";

const rows: { term: string; command: string; category: string; criticality: "hoch" | "normal" }[] = [
  // FRUCHTBARKEIT
  { term: "Pregnancy Rate / Brunstkontrolle", command: "BREDSUM\\E", category: "Fruchtbarkeit", criticality: "hoch" },
  { term: "Tragende Kühe anzeigen", command: "SHOW ID PEN DIM LACT RPRO FOR RC=5 INMILK", category: "Fruchtbarkeit", criticality: "hoch" },
  { term: "Offene Kühe TU-negativ", command: "SHOW ID DIM LACT PEN RPRO FOR RC=2;3 INMILK", category: "Fruchtbarkeit", criticality: "hoch" },
  { term: "ZU-Tiere nicht mehr besamen", command: "SHOW ID DIM LACT PEN RPRO WMLK1 FOR RC=1 INMILK", category: "Fruchtbarkeit", criticality: "hoch" },
  { term: "Reproduktionsstatus Überblick", command: "SUM BY RPRO PEN FOR LACT>0", category: "Fruchtbarkeit", criticality: "hoch" },
  { term: "TU-Liste aufrufen", command: "VLIST", category: "Fruchtbarkeit", criticality: "hoch" },
  { term: "TU-Ergebnisse eingeben", command: "VENTER", category: "Fruchtbarkeit", criticality: "hoch" },
  { term: "Einzeltier TU-negativ eingeben", command: "OPEN / OFFEN", category: "Fruchtbarkeit", criticality: "normal" },
  { term: "Einzeltier TU-positiv eingeben", command: "PREG / TRAGEND", category: "Fruchtbarkeit", criticality: "normal" },
  { term: "Einzeltier TU-positiv ohne Besamungsdatum", command: "PREV", category: "Fruchtbarkeit", criticality: "normal" },
  { term: "Überfällige Kalbungen über 280 Tage", command: "SHOW ID DIM LACT DCC DUE SIRC FOR DCC>280 DOWNBY DCC", category: "Fruchtbarkeit", criticality: "hoch" },
  { term: "Kühe 50-150 Tage nicht tragend", command: "SHOW ID DIM LACT PEN RPRO TBRD FOR DIM=50-150 RC=2;3 INMILK BY DIM", category: "Fruchtbarkeit", criticality: "hoch" },
  { term: "Besamungsfähige Färsen ab 365 Tagen", command: "SHOW ID PEN BDAT AGED RPRO FOR TBRD=0 AGED>365 LACT=0 RC<>1 DOWNBY AGED", category: "Fruchtbarkeit", criticality: "normal" },
  { term: "Kühe mehrfach besamt über 3x", command: "SHOW ID DIM TBRD WMLK1 FOR TBRD>3 LACT>0", category: "Fruchtbarkeit", criticality: "normal" },
  { term: "Besamungsstop setzen", command: "BSTOP", category: "Fruchtbarkeit", criticality: "normal" },
  { term: "Abort eingeben", command: "ABORT", category: "Fruchtbarkeit", criticality: "normal" },
  // DATENEINGABE
  { term: "Besamung eingeben", command: "BRED / BESAMT", category: "Eingabe", criticality: "normal" },
  { term: "Kalbung eingeben", command: "FRESH / KALBUNG", category: "Eingabe", criticality: "normal" },
  { term: "Trockenstellen", command: "DRY / TROCKEN", category: "Eingabe", criticality: "normal" },
  { term: "Verkauf eingeben", command: "SOLD / VERKAUF", category: "Eingabe", criticality: "normal" },
  { term: "Tier verendet", command: "DIED / TOD", category: "Eingabe", criticality: "normal" },
  { term: "Zuchtuntauglich setzen", command: "DNB / ZU", category: "Eingabe", criticality: "normal" },
  { term: "Stallnummer ändern", command: "XID", category: "Eingabe", criticality: "normal" },
  { term: "Einzeltier auf TU-Liste setzen", command: "CHECK", category: "Eingabe", criticality: "normal" },
  { term: "Transpondernummer eingeben", command: "TRANS", category: "Eingabe", criticality: "normal" },
  // EUTERGESUNDHEIT
  { term: "Kühe mit Zellzahl über 200", command: "SHOW ID DIM LACT SCC FOR SCC>200 DOWNBY SCC", category: "Eutergesundheit", criticality: "hoch" },
  { term: "Mastitis eingeben", command: "MAST", category: "Eutergesundheit", criticality: "hoch" },
  { term: "Zellzahl-Verlauf Tier", command: "Kuhkarte aufrufen MLP-Tage Reiter", category: "Eutergesundheit", criticality: "hoch" },
  // GESUNDHEIT
  { term: "Ketose eingeben", command: "KETOSIS / KETOSE", category: "Gesundheit", criticality: "normal" },
  { term: "Lahmheit eingeben", command: "LAME / LAHM", category: "Gesundheit", criticality: "normal" },
  { term: "Labmagenverlagerung", command: "DA / LMV", category: "Gesundheit", criticality: "normal" },
  { term: "Milchfieber", command: "MF", category: "Gesundheit", criticality: "normal" },
  { term: "Metritis", command: "METR", category: "Gesundheit", criticality: "normal" },
  { term: "Durchfall", command: "DIARHEA", category: "Gesundheit", criticality: "normal" },
  { term: "Lungenentzündung", command: "PNEU / LUNGE", category: "Gesundheit", criticality: "normal" },
  { term: "Nachgeburtsverhalten", command: "NGV", category: "Gesundheit", criticality: "normal" },
  { term: "Pansenstörung", command: "PANSEN", category: "Gesundheit", criticality: "normal" },
  // PRODUKTION
  { term: "Frische Kühe bis Tag 50", command: "SHOW ID DIM LACT PEN DMLK1 DMLK2 DMLK3 DMLK4 DMLK5 DMLK6 DMLK7 WMLK1 FOR DIM<50 INMILK BY DIM", category: "Produktion", criticality: "normal" },
  { term: "Melkstandbericht letzte Melkzeit", command: "PARLOR\\WM1", category: "Produktion", criticality: "hoch" },
  { term: "Melkstandbericht zweite Melkzeit", command: "PARLOR\\WM2", category: "Produktion", criticality: "normal" },
  { term: "Milchleistung nach Gruppen", command: "SHOW ID PEN DIM LACT MILK RPRO FOR LACT>1 INMILK BY PEN", category: "Produktion", criticality: "normal" },
  { term: "Lebensleistung", command: "LTDM in SHOW-Befehl", category: "Produktion", criticality: "normal" },
  // AUSWERTUNGEN
  { term: "Ereignisse auswerten allgemein", command: "EVENTS", category: "Auswertung", criticality: "normal" },
  { term: "Kalbungen in Zeitraum", command: "EVENTS\\2SI mit Ereignis KALBUNG", category: "Auswertung", criticality: "normal" },
  { term: "Kälberbericht", command: "EVENTS\\3", category: "Auswertung", criticality: "normal" },
  { term: "Milchkontrollen", command: "EVENTS\\4", category: "Auswertung", criticality: "hoch" },
  { term: "Ereignisse nach Monaten", command: "EVENTS\\5", category: "Auswertung", criticality: "normal" },
  { term: "Ereignisse nach Laktationstagen", command: "EVENTS\\6", category: "Auswertung", criticality: "normal" },
  { term: "Ereignisse nach Abkalbemonat", command: "EVENTS\\7", category: "Auswertung", criticality: "normal" },
  { term: "Besamungen nach Bullen", command: "BREDSUM\\S", category: "Auswertung", criticality: "normal" },
  { term: "Besamungen nach Technikern", command: "BREDSUM\\T", category: "Auswertung", criticality: "normal" },
  { term: "Besamungen nach Zyklen", command: "BREDSUM\\N", category: "Auswertung", criticality: "normal" },
  { term: "Besamungen nach Wochentagen", command: "BREDSUM\\W", category: "Auswertung", criticality: "normal" },
  // VERWALTUNG
  { term: "Bulle bearbeiten", command: "ALTER\\8", category: "Verwaltung", criticality: "normal" },
  { term: "Befehl speichern", command: "ALTER dann Punkt 3 Befehle", category: "Verwaltung", criticality: "normal" },
  { term: "Gruppe anlegen", command: "ALTER\\4", category: "Verwaltung", criticality: "normal" },
  { term: "Menü bearbeiten", command: "SETUP", category: "Verwaltung", criticality: "normal" },
  { term: "Cleanup starten", command: "CLEANUP", category: "Verwaltung", criticality: "normal" },
  { term: "Kuh aus Archiv holen", command: "GETCOW", category: "Verwaltung", criticality: "normal" },
  { term: "Tier löschen", command: "DELETE\\Z", category: "Verwaltung", criticality: "normal" },
];

async function seed() {
  // Delete existing glossar document (idempotent)
  const existing = await db
    .select({ id: knowledgeDocumentsTable.id })
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.documentType, "dairycomp_glossar"));

  for (const doc of existing) {
    await db.delete(knowledgeChunksTable).where(eq(knowledgeChunksTable.docId, doc.id));
    await db.delete(knowledgeDocumentsTable).where(eq(knowledgeDocumentsTable.id, doc.id));
  }

  // Insert document record
  const [doc] = await db
    .insert(knowledgeDocumentsTable)
    .values({
      title: GLOSSAR_TITLE,
      filename: "dairycomp_glossar.txt",
      fileType: "txt",
      objectPath: "system/dairycomp_glossar",
      status: "ready",
      documentType: "dairycomp_glossar",
      uploadedBy: "system",
      chunkCount: rows.length,
      category: "DairyComp",
    })
    .returning();

  // Insert one chunk per row — no embedding needed (keyword search only)
  await db.insert(knowledgeChunksTable).values(
    rows.map((r, i) => ({
      docId: doc.id,
      chunkIndex: i,
      chunkText: [
        `Alltagsbegriff: ${r.term}`,
        `Befehl: ${r.command}`,
        `Kategorie: ${r.category}`,
        `Kritikalität: ${r.criticality}`,
      ].join("\n"),
      // embedding intentionally null — glossar is searched via ILIKE, not vector
    })),
  );

  console.log(`✓ DairyComp-Glossar eingefügt: ${rows.length} Einträge (Doc-ID: ${doc.id})`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Fehler beim Seeden:", err);
  process.exit(1);
});

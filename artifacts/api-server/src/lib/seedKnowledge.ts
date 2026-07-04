/**
 * Static system knowledge documents that are seeded automatically at server
 * startup. If the DB record is missing or in error state, the content is
 * uploaded to object storage and (re-)ingested. This ensures the documents
 * are never permanently lost between deployments.
 */

import { randomUUID } from "crypto";
import { eq, or } from "drizzle-orm";
import { db, knowledgeDocumentsTable } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { ingestKnowledgeDoc } from "./ingest";
import { logger } from "./logger";

const objectStorage = new ObjectStorageService();

// ── DairyComp 305 Befehlsglossar ─────────────────────────────────────────────

const DAIRYCOMP_GLOSSAR_TEXT = `
DairyComp 305 – Befehlsreferenz und Praxisanleitung (Deutsch/Englisch)

=== WAS IST DAIRYCOMP 305? ===
DairyComp 305 (DC 305) ist ein Herdenmanagement-Software-System von Valley Agricultural Software (VAS), das auf Milchviehbetrieben weltweit eingesetzt wird. Es speichert alle Tierereignisse (Events) und ermöglicht die Auswertung von Fruchtbarkeit, Gesundheit, Milchleistung und Bestandsübersichten.

=== PREGRATE / TRÄCHTIGKEITSRATE ===

Wie bekomme ich die Pregrate (Trächtigkeitsrate) aus DC 305?

Die Pregnancy Rate (PR / Pregrate / Trächtigkeitsrate) zeigt, wie viel Prozent der besamungsfähigen Kühe je 21-Tage-Periode trächtig werden.
Formel: PR = Conception Rate × 21-Tage-Besamungsrate (Submission Rate)

Methode 1 – PARMS-Bericht (einfachste Methode):
Gib in DC 305 ein: PARMS
→ Zeigt aktuelle Herdenparameter inkl. 21-Tage-Trächtigkeitsrate (21-day pregnancy rate).

Methode 2 – REPRO-Bericht:
Gib ein: REPRO
→ Zeigt Reproduktionskennzahlen: Besamungsrate, Konzeptionsrate, Pregrate, Leerperiode.

Methode 3 – SUMREPRO / SUMMARY REPRO:
Gib ein: SUMREPRO oder LIST SUMREPRO
→ Zusammenfassung Reproduktionsleistung für einen wählbaren Zeitraum.

Methode 4 – GRAPH PR:
Gib ein: GRAPH PR 365
→ Zeigt die Pregrate als Grafik über die letzten 365 Tage.

Methode 5 – Manuelle Berechnung über EVENTS:
LIST EVENT CODE BRED DATE [zeitraum]  → Anzahl Besamungen
LIST EVENT CODE PREG DATE [zeitraum]  → Anzahl Trächtigkeitstests
→ Konzeptionsrate = PREG (result P) / BRED × 100
→ Besamungsrate = Besamungen pro 21 Tage / besamungsfähige Kühe × 100

=== HÄUFIGE DC-BEFEHLE ===

HELP                  – Hilfemenü anzeigen
HELP [Befehl]         – Hilfe zu einem bestimmten Befehl

--- Tierlisten ---
LIST                  – Kühe auflisten (Standard: alle aktiven Kühe)
LIST DIM [n]          – Kühe mit mehr als n Laktationstagen
LIST STATUS [code]    – Kühe nach Status filtern
LIST FRESH            – Kühe, die in den letzten Tagen gekalbt haben
LIST DUE              – Kühe mit erwartetem Kalbetermin
LIST OPEN             – Nicht-trächtige Kühe (offen)
LIST BRED             – Besamte Kühe
LIST DRY              – Trockengestellte Kühe
LIST SICK             – Kranke/behandelte Kühe

--- Ereignisse ---
EVENTS [TAG-ID]       – Alle Ereignisse eines Tieres anzeigen
LIST EVENT CODE [code] – Tiere mit bestimmtem Ereigniscode auflisten
LIST EVENT DATE [von] [bis] – Ereignisse in Zeitraum

--- Berichte ---
PARMS                 – Herdenparameter (Pregrate, VWP, DO, etc.)
REPRO                 – Reproduktionsbericht (Besamungsrate, Konzeptionsrate, PR)
FRESH                 – Frischmelker-Bericht
DIM                   – Laktationstage-Verteilung
SCC                   – Zellzahlbericht (Somatic Cell Count)
GRAPH [Kennzahl]      – Grafische Darstellung einer Kennzahl

--- Eingabe neuer Ereignisse ---
ADD EVENT [TAG] [Code] [Datum] – Ereignis manuell hinzufügen
EDIT [TAG]            – Tierdatensatz bearbeiten

=== EREIGNISCODES (EVENT CODES) ===

Fruchtbarkeit:
BRED    – Besamung (insemination). Felder: Stier-ID, Techniker
PREG    – Trächtigkeitsuntersuchung. Ergebnis: P=positiv (trächtig), N=negativ (leer), A=Abort
ABORT   – Abort / Umrauscher nach positivem Test
HEAT    – Brunst beobachtet

Kalbung & Trockenstellen:
FRESH   – Abkalbung (Kalbung). Felder: Kalbdatum, Kalb-ID, Kalbeverlauf
CALV    – Alternative zu FRESH
DRY     – Trockenstellen (Dry-off)
PROJDRY – Geplantes Trockenstelldatum

Gesundheit:
MAST    – Mastitis-Behandlung
LAME    – Lahmheit
SICK    – Allgemeine Erkrankung
CULL    – Abgang / Merzung (Tier aus Herde)
SOLD    – Verkauft
DIED    – Verendet

Sonstiges:
DO      – Brunstbeobachtungs-Beginn (Days Open at breeding start)
VWP     – Freiwillige Wartezeit (Voluntary Waiting Period)
MILK    – Milcheintrag / MLP-Daten

=== KENNZAHLEN ERKLÄRUNG ===

Pregrate (PR) / Trächtigkeitsrate:
- Anteil der besamungsfähigen Kühe, die je 21-Tage-Zyklus trächtig werden
- Gut: > 22–25 %, Durchschnitt DE: ~18–22 %
- Formel: PR = Conception Rate × Submission Rate

Conception Rate (CR) / Konzeptionsrate:
- Anteil der Besamungen, die zur Trächtigkeit führen
- Gut: > 40–45 % bei Färsen, 35–40 % bei Kühen

Submission Rate (SR) / Besamungsrate:
- Anteil der besamungsfähigen Kühe, die je 21 Tage besamt werden
- Gut: > 80–90 %

Days Open (DO) / Leerperiode:
- Tage von der Abkalbung bis zur Trächtigkeit
- Ziel: < 120–140 Tage

Voluntary Waiting Period (VWP) / Freiwillige Wartezeit:
- Mindest-Wartezeit nach Kalbung vor erster Besamung
- Typisch: 50–70 Tage

DIM / Days in Milk (Laktationstage):
- Tage seit letzter Kalbung

305ME / 305-Tage-Milchleistung:
- Standardisierte Laktationsleistung auf 305 Tage hochgerechnet

SCC / Zellzahl (Somatic Cell Count):
- Maß für Eutergesundheit
- Gut: < 200.000 Zellen/ml; kritisch: > 400.000 Zellen/ml

=== TYPISCHE AUSWERTUNGEN MIT DC 305 ===

Überfällige Trächtigkeitsuntersuchungen finden:
LIST BRED NOT PREG DIM > 35
→ Kühe, die vor mehr als 35 Tagen besamt wurden, aber noch kein PREG-Ergebnis haben

Brunst-Synchronisations-Protokoll (Ovsynch) verwalten:
LIST EVENT CODE GNRH DATE [datum]
LIST EVENT CODE PGF DATE [datum]

Alle offenen Kühe (ohne Trächtigkeit) anzeigen:
LIST OPEN DIM > 60
→ Kühe, die mehr als 60 DIM sind und nicht besamt/trächtig

Trockensteher-Liste:
LIST DRY PROJFRESH > [datum]
→ Trockengestellte Kühe mit erwartetem Kalbedatum nach einem Stichtag

Kühe mit hoher Zellzahl (Mastitis-Risiko):
LIST SCC > 400
→ Kühe mit letzter Zellzahl > 400.000

Erstkalbinnen (Färsen) in Laktation:
LIST LACT = 1

Kühe mit Kalbungen in bestimmtem Zeitraum:
LIST FRESH DATE [von bis]

=== DC 305 BERICHTE FÜR FRUCHTBARKEIT ===

21-Tage-Takt-Bericht (21-day reproductive summary):
Befehl: REPRO oder PARMS
Zeigt für jeden 21-Tage-Zeitraum:
- Anzahl besamungsfähige Kühe (Eligible)
- Anzahl Besamungen (Bred)
- Besamungsrate (Submission Rate, SR)
- Anzahl positive Trächtigkeitstests (Preg)
- Konzeptionsrate (Conception Rate, CR)
- Trächtigkeitsrate (Pregnancy Rate = SR × CR)

=== DATENEXPORT AUS DC 305 ===

Export als CSV/Text:
LIST [Bedingung] EXPORT
→ Exportiert die Trefferliste in eine Datei

Export für externe Auswertung (z.B. Bovial):
FILE [Befehlsfolge]
→ Gibt den Bericht in eine Textdatei aus

Standard-HMS-Export (für Bovial-Upload):
In DC 305 ist kein direkter HMS-Export-Button vorhanden. 
Die Exportdaten werden typischerweise über den Betrieb/Berater als CSV-Datei bereitgestellt.
Für Bovial werden folgende Daten benötigt:
- Tierstammdaten (ID, Geburtsdatum, Laktationsnummer)
- Ereignisse: BRED, PREG, FRESH, DRY, CULL, SOLD, DIED
- Milchleistungsdaten (MLP/DHI-Daten)
- Zellzahlmessungen

=== HÄUFIGE FRAGEN UND ANTWORTEN ===

F: Wie bekomme ich die Pregrate aus DC?
A: Gib PARMS oder REPRO ein. Unter "21-day Pregnancy Rate" oder "PR" findest du den aktuellen Wert.
   Alternativ: GRAPH PR 365 zeigt die Entwicklung über das letzte Jahr als Grafik.

F: Wie sehe ich alle Kühe, die besamt werden müssen?
A: LIST OPEN DIM > [VWP] — z.B. LIST OPEN DIM > 60 für alle offenen Kühe über 60 DIM.
   Oder: LIST HEAT für Kühe mit beobachteter Brunst.

F: Wie trage ich eine Besamung ein?
A: ADD EVENT [Ohrmarke] BRED [Datum] [Stier-Code]
   Beispiel: ADD EVENT 12345 BRED 2024-06-15 BullXY

F: Wie sehe ich die Trächtigkeitstests der letzten Woche?
A: LIST EVENT CODE PREG DATE [datum vor 7 Tagen] [heutiges datum]

F: Wie finde ich Kühe mit fehlendem Trächtigkeitstest?
A: LIST BRED NOT PREG DIM > 35

F: Was bedeutet PREG result P/N/A?
A: P = Positiv (trächtig), N = Negativ (nicht trächtig / leer), A = Abort

F: Wie berechne ich die Konzeptionsrate manuell?
A: (Anzahl PREG mit Ergebnis P) / (Anzahl BRED) × 100
   Über DC: REPRO oder SUMREPRO zeigt CR direkt.

F: Wie sehe ich alle Abkalbungen des letzten Monats?
A: LIST FRESH DATE [erster des Monats] [letzter des Monats]

F: Wie drucke ich eine Besärungs-/Aktivitätsliste?
A: LIST [Bedingung] PRINT oder LIST [Bedingung] REPORT

=== VERSION UND SUPPORT ===

Version prüfen: In DC 305 Hauptmenü → Help → About
DairyComp 305 Support: Valley Agricultural Software (VAS), +1-559-688-3871, www.vas.com
Deutsch-sprachiger Support: Über regionalen Distributeur oder LKV / Landeskontrollverband

DairyComp Benutzerhandbuch (englisch): Im Installationsverzeichnis als PDF oder unter vas.com/documentation
`.trim();

// ── Seed helper ──────────────────────────────────────────────────────────────

interface SystemDoc {
  /** Stable lookup key stored in object_path to identify this doc even after re-uploads */
  objectSubpath: string;
  title: string;
  documentType: string;
  fileType: "txt";
  content: string;
}

const SYSTEM_DOCS: SystemDoc[] = [
  {
    objectSubpath: "knowledge/system-dairycomp-glossar.txt",
    title: "DairyComp 305 Befehlsglossar",
    documentType: "dairycomp_glossar",
    fileType: "txt",
    content: DAIRYCOMP_GLOSSAR_TEXT,
  },
];

export async function seedSystemKnowledge(): Promise<void> {
  for (const doc of SYSTEM_DOCS) {
    try {
      const objectPath = `/objects/${doc.objectSubpath}`;

      // Find existing record by documentType (stable identifier)
      const existing = await db
        .select({
          id: knowledgeDocumentsTable.id,
          status: knowledgeDocumentsTable.status,
          objectPath: knowledgeDocumentsTable.objectPath,
        })
        .from(knowledgeDocumentsTable)
        .where(eq(knowledgeDocumentsTable.documentType as any, doc.documentType))
        .limit(1);

      const record = existing[0];

      // Upload the content to object storage (always refresh to keep in sync)
      const buf = Buffer.from(doc.content, "utf-8");
      await objectStorage.uploadBytesAsEntity(doc.objectSubpath, buf, "text/plain");

      if (!record) {
        // Create new record
        const id = randomUUID();
        await db.insert(knowledgeDocumentsTable).values({
          id,
          title: doc.title,
          filename: `${doc.documentType}.txt`,
          fileType: doc.fileType,
          status: "pending",
          objectPath,
          size: buf.length,
          documentType: doc.documentType,
          uploadedBy: "system",
        });
        logger.info({ id, title: doc.title }, "System-Wissensdokument angelegt, Ingestion wird gestartet");
        await ingestKnowledgeDoc(id);
      } else if (record.status === "error" || record.objectPath !== objectPath) {
        // Fix broken record: update path + reset to pending, then ingest
        await db
          .update(knowledgeDocumentsTable)
          .set({ status: "pending", objectPath, errorMessage: null })
          .where(eq(knowledgeDocumentsTable.id, record.id));
        logger.info({ id: record.id, title: doc.title, was: record.status }, "System-Wissensdokument wird neu ingested");
        await ingestKnowledgeDoc(record.id);
      } else {
        logger.info({ id: record.id, title: doc.title, status: record.status }, "System-Wissensdokument bereits aktuell");
      }
    } catch (err) {
      logger.warn({ err, title: doc.title }, "seedSystemKnowledge: Fehler beim Seeden");
    }
  }
}

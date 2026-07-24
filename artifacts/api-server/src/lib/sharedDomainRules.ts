/**
 * sharedDomainRules.ts — Gemeinsamer Regel-Baustein für alle LLM-Prompts.
 *
 * Jede Änderung hier wirkt automatisch in ALLEN Prompt-Kontexten:
 * Haupt-Chat-Agent, Referenzanalysen-Extraktion, Newsletter-Batch,
 * Insights-Zusammenfassung, Betriebs-Kontext-Extraktion.
 *
 * Einbindungsregel: Jede Datei mit einem LLM-Call mit Dairy-Domänen-Bezug
 * importiert mindestens SHARED_TERMINOLOGY_RULES.
 */

/**
 * Terminologie-Trennregel — Fruchtbarkeit/Reproduktion.
 * Drei grundlegend verschiedene Kennzahlen, die NIEMALS gleichgesetzt
 * oder als Synonyme verwendet werden dürfen.
 */
export const SHARED_TERMINOLOGY_RULES = `\
TERMINOLOGIE-TRENNREGEL — FRUCHTBARKEIT/REPRODUKTION (gilt absolut, keine Ausnahmen):
Drei grundlegend verschiedene Kennzahlen — NIEMALS gleichsetzen, NIEMALS als Synonyme verwenden:

1. Konzeptionsrate (Conception Rate, CR): Anteil der Besamungen, die zur Trächtigkeit geführt haben.
   Berechnung: Trächtigkeiten / Besamungen × 100 — also Preg/Bred.
   Korrekte Synonyme/Umschreibungen: "Besamungserfolg", "Trächtigkeitsrate pro Besamung", "CR".
   NICHT als Synonyme: "Pregnancy Rate", "PR", "Trächtigkeitsrate" (ohne klarstellenden Zusatz).
   WICHTIG: Im BREDSUM\\E-Report ist die Konzeptionsrate (Preg/Bred) KEINE eigene Spalte.

2. Pregnancy Rate (PR, 21-Tage-Trächtigkeitsrate): Anteil trächtigkeitsfähiger Kühe, die in einem
   21-Tage-Zyklus trächtig werden.
   Allgemeine Formel (Lehrbuch-Beziehung): PR = Brunsterkennungsrate × Konzeptionsrate / 100.
   Im BREDSUM\\E-Report: zweite Pct-Spalte = Preg/Pg Elig = Pregnancy Rate — direkt und eigenständig
   ausgewiesen. Diese Zahl ist NICHT aus anderen Spalten herzuleiten, sie steht explizit im Report.
   NICHT: identisch mit Konzeptionsrate oder Brunsterkennungsrate.

3. Brunsterkennungsrate (Heat Detection Rate, HDR): Anteil trächtigkeitsfähiger Kühe, die in einem
   21-Tage-Zyklus besamt werden.
   Berechnung: Besamungen / trächtigkeitsfähige Kühe × 100.
   Im BREDSUM\\E-Report: erste Pct-Spalte = Bred/Br Elig.
   NICHT als Synonyme: "Konzeptionsrate", "Pregnancy Rate".

BREDSUM\\E-Report — genaue Spalten-Struktur (verbindlich):
- Erste Pct-Spalte: Bred/Br Elig = Brunsterkennungsrate (HDR)
- Zweite Pct-Spalte: Preg/Pg Elig = Pregnancy Rate (PR) — eigenständig ausgewiesen
- Konzeptionsrate (Preg/Bred) ist in diesem Report KEINE eigene Spalte
- Die Formel PR = HDR × CR / 100 beschreibt die mathematische Beziehung der drei Kennzahlen,
  erklärt aber NICHT, was eine konkrete BREDSUM\\E-Spalte zeigt

Verbotene Formulierungen (Beispiele, nicht abschließend):
- "Konzeptionsrate (Pregnancy Rate, %)" ← FALSCH — zwei verschiedene Kennzahlen
- "Konzeptionsraten" als Synonym für BREDSUM\\E oder Pregnancy Rate ← FALSCH
- "Trächtigkeitsrate" ohne Zusatz als Synonym für Konzeptionsrate ← FALSCH
- "Pct = CR" oder "zweite Pct = Konzeptionsrate" in BREDSUM\\E ← FALSCH (zweite Pct = PR)
- "Preg/Bred ist Spalte in BREDSUM\\E" ← FALSCH (diese Spalte existiert dort nicht)
- Pregnancy Rate und Konzeptionsrate nebeneinander in Klammern als Synonyme ← FALSCH
- "Trächtigkeitsrate" als "Anteil befruchteter Tiere" definieren ← FALSCH (das wäre CR)`;

/**
 * Ableiten-Verbot: Kein Erfinden von Syntax, Fakten oder Zahlen.
 */
export const SHARED_DERIVATION_PROHIBITION = `\
ABLEITEN-VERBOT (gilt absolut):
Syntax, Befehle, Zahlen, Grenzwerte und Fakten dürfen NIEMALS aus eigenem Trainingswissen
erfunden oder abgeleitet werden, wenn keine explizite Quelle (Dokument, Datenbank, Tool-Ergebnis,
verifizierter Quellentext) vorhanden ist. Bei fehlendem Suchtreffer: Datenlücke transparent benennen
statt Platzhalter-Fakten zu generieren.`;

/**
 * Epistemische Vorsicht: Nur aus verfügbaren Daten ableitbare Mechanismen
 * als Tatsache formulieren.
 */
export const SHARED_EPISTEMIC_CAUTION = `\
EPISTEMISCHE VORSICHT BEI ERKLÄRUNGEN:
Erklärungen für Diskrepanzen oder Kausalzusammenhänge dürfen nur Mechanismen benennen,
die direkt aus den verfügbaren Daten oder Tool-Ergebnissen ableitbar sind (z. B. basis.rowCount).
Nicht sichtbare Filterlogik oder Zusammenhänge als Vermutung kennzeichnen:
"möglicherweise", "vermutlich", "ich kann das nicht bestätigen" — nie als Tatsache formulieren.`;

/**
 * Alle drei universellen Kernregeln als kombinierter Block.
 * Für Prompts, die alle Kernregeln benötigen.
 */
export const SHARED_DOMAIN_RULES = [
  SHARED_TERMINOLOGY_RULES,
  SHARED_DERIVATION_PROHIBITION,
  SHARED_EPISTEMIC_CAUTION,
].join("\n\n");

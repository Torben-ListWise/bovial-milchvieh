import { pool } from "./index";

export async function ensureExtensions(): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  // Migration: add template_ref column for auto-analysis deduplication
  await pool.query(
    "ALTER TABLE analyses ADD COLUMN IF NOT EXISTS template_ref TEXT"
  );
  // Drop old broad unique index (prevented multiple template runs per dataset)
  await pool.query(
    "DROP INDEX IF EXISTS analyses_dataset_template_ref_unique"
  );
  // Partial unique index only for auto_erstanalyse (deduplication of auto-analysis)
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS analyses_dataset_auto_unique ON analyses (dataset_id, template_ref) WHERE template_ref = 'auto_erstanalyse'"
  );
  // Migration: analysis_templates table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analysis_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📊',
      short_description TEXT NOT NULL DEFAULT '',
      prompt_text TEXT NOT NULL,
      category_tag TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Seed default Milchvieh templates if table is empty
  const { rows } = await pool.query("SELECT COUNT(*)::int as c FROM analysis_templates");
  if ((rows[0]?.c ?? 0) === 0) {
    await pool.query(`
      INSERT INTO analysis_templates (title, emoji, short_description, prompt_text, category_tag, sort_order) VALUES
      ('Milchleistungs-Trend', '🥛', '12-Monats-Verlauf, Vergleich Vorjahr, Top-10 Tiere', 'Wie hat sich meine Milchleistung in den letzten 12 Monaten entwickelt? Zeige monatlichen Trend, Vergleich Vorjahr und Top-10 Tiere.', 'milchvieh', 10),
      ('Eutergesundheit & SCC', '🔬', 'Zellzahl-Trend und auffällige Tiere', 'Analysiere meinen Zellzahl-Trend der letzten 12 Monate. Identifiziere auffällige Tiere (SCC > Richtwert aus Stammdaten) und zeige den Verlauf.', 'milchvieh', 20),
      ('Fruchtbarkeit aktuell', '🐄', 'Zwischenkalbezeit, Erstbesamungserfolg, Brunsterkennungsrate', 'Berechne meine Fruchtbarkeitskennzahlen: Zwischenkalbezeit, Erstbesamungserfolg, Brunsterkennungsrate. Vergleiche mit Normwerten aus den Stammdaten.', 'milchvieh', 30),
      ('Erstlaktierende-Leistung', '🐮', 'Vergleich Erst- vs. Mehrkalbskühe', 'Vergleiche die Milchleistung meiner Erstkalbskühe mit Zweit- und Mehrkalbskühen. Gibt es Auffälligkeiten bei den Erstlaktierenden?', 'milchvieh', 40),
      ('Herdenstruktur & Remontierung', '📋', 'Laktationsnummern-Verteilung und Remontierungsrate', 'Zeige meine Herdenstruktur nach Laktationsnummern als Diagramm. Berechne die aktuelle Remontierungsrate und vergleiche mit dem Zielwert.', 'milchvieh', 50),
      ('Abgänge & Abgangsursachen', '⚠️', 'Letzte 6 Monate: Anzahl, Ursachen, Trend', 'Analysiere die Abgänge der letzten 6 Monate: Anzahl, Abgangsursachen als Kreisdiagramm, Trend und Auffälligkeiten.', 'milchvieh', 60),
      ('Kalbungsübersicht', '🍼', 'Letzte 60 Tage: Verlauf, Totgeburten, Kalbeschwerden', 'Zeige alle Kalbungen der letzten 60 Tage: Verlauf, Totgeburtenrate, Kalbeschwerden. Gibt es Häufungen oder Trends?', 'milchvieh', 70),
      ('Fütterungseffizienz', '🌾', 'Kraftfuttereinsatz und Milch-Futter-Verhältnis', 'Analysiere Kraftfuttereinsatz und Milch-Futter-Verhältnis. Falls Fütterungsdaten vorhanden: Optimierungspotenzial und Vergleich mit Richtwerten.', 'milchvieh', 80),
      ('Top-3 Handlungsempfehlungen', '💡', 'Die dringendsten Maßnahmen mit Begründung', 'Analysiere alle verfügbaren Kennzahlen und formuliere die drei dringendsten konkreten Handlungsempfehlungen mit Begründung und erwarteter Wirkung.', 'milchvieh', 90),
      ('Betriebsvergleich Richtwerte', '📊', 'Ist-Wert vs. Zielwert vs. Abweichung', 'Vergleiche alle Kern-KPIs mit den Stammdaten-Richtwerten. Erstelle eine Übersichtstabelle: Ist-Wert vs. Zielwert vs. Abweichung. Färbe kritische Werte hervor.', 'milchvieh', 100),
      ('Investitionsprüfung', '💰', 'Wirtschaftlichkeitsprüfung einer geplanten Investition', 'Ich möchte eine Investition wirtschaftlich prüfen. Lies zunächst meine aktuellen Betriebsdaten (Herdengröße, Milchleistung, relevante KPIs). Stelle mir dann die notwendigen Fragen (Investitionssumme, Laufzeit, Zinssatz, erwarteter Nutzen), um Amortisation und Rentabilität zu berechnen.', NULL, 110)
    `);
  }
}

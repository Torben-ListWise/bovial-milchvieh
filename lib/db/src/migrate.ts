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
  // Migration: sector column on datasets (default: dairy for backwards compat)
  await pool.query(
    "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS sector TEXT NOT NULL DEFAULT 'dairy'"
  );
  // Migration: sector column on master_data (NULL = applies to all sectors)
  await pool.query(
    "ALTER TABLE master_data ADD COLUMN IF NOT EXISTS sector TEXT"
  );
  // Migration: focus_areas column on users (array of farm focus area tags)
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS focus_areas TEXT[]"
  );
  // Migration: onboarding_completed_at — set after farmer's first file upload
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ"
  );
  // Migration: detected_focus_area and confidence on datasets (farm type auto-detection)
  await pool.query(
    "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS detected_focus_area TEXT"
  );
  await pool.query(
    "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS detected_focus_area_confidence REAL"
  );
  // Migration: back_questions column on messages (structured agent back-questions)
  await pool.query(
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS back_questions JSONB"
  );
  // Migration: widget_spec column on messages (interactive chat calculators)
  await pool.query(
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS widget_spec JSONB"
  );
  // Migration: hidden column on messages (internal trigger prompts hidden from chat UI)
  await pool.query(
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE"
  );
  // Migration: farm_notes table — free-text operator hints injected into agent context
  await pool.query(`
    CREATE TABLE IF NOT EXISTS farm_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS farm_notes_user_id_idx ON farm_notes (user_id)"
  );
  // Backfill: mark existing auto-trigger prompt messages as hidden.
  // Targets user messages in analyses with source='auto' and template_ref='auto_erstanalyse'
  // where the content contains recognizable internal agent instructions.
  await pool.query(`
    UPDATE messages
    SET hidden = TRUE
    WHERE hidden = FALSE
      AND role = 'user'
      AND analysis_id IN (
        SELECT id FROM analyses
        WHERE source = 'auto'
          AND template_ref = 'auto_erstanalyse'
      )
      AND (
        content LIKE '%get_schema%'
        OR content LIKE '%get_kpis%'
        OR content LIKE '%get_timeseries%'
        OR content LIKE '%Betriebsspiegel%'
        OR content LIKE '%read_document%'
      )
  `);
  // Migration: source_url column on knowledge_documents (for URL-ingested entries)
  await pool.query(
    "ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS source_url TEXT"
  );
  // Migration: embedding_model column to track which model embedded each document
  await pool.query(
    "ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS embedding_model TEXT"
  );
  // Migration: category column for AI-based topic classification
  await pool.query(
    "ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS category TEXT"
  );
  // Performance: HNSW vector index — only in production.
  // The Replit deployment system introspects the dev DB to generate production
  // migrations. If the dev DB has this index, Drizzle regenerates the SQL without
  // vector_cosine_ops (bug with custom types), causing "no default operator class"
  // errors on production. Keeping the dev DB index-free prevents that diff.
  // In production the server creates it correctly at every startup (idempotent).
  if (process.env.NODE_ENV === "production") {
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
        ON knowledge_chunks
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);
    } catch (err: any) {
      // 23505 = duplicate key: index already exists (race condition with IF NOT EXISTS)
      if (err?.code !== "23505") throw err;
    }
  }
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
      ('Investitionsprüfung', '💰', 'Wirtschaftlichkeitsprüfung einer geplanten Investition', 'Ich möchte eine Investition wirtschaftlich prüfen. Lies zunächst meine aktuellen Betriebsdaten (Herdengröße, Milchleistung, relevante KPIs). Stelle mir dann die notwendigen Fragen (Investitionssumme, Laufzeit, Zinssatz, erwarteter Nutzen), um Amortisation und Rentabilität zu berechnen.', NULL, 110),
      ('Tageszunahmen-Trend', '📈', 'Tägliche Zunahmen je Mastgruppe und Zeitraum', 'Analysiere die täglichen Gewichtszunahmen (g/Tag) je Mastgruppe über den hochgeladenen Zeitraum. Identifiziere Gruppen unter dem Richtwert, zeige den Trend als Diagramm und benenne mögliche Ursachen für Abweichungen.', 'schweine', 400),
      ('Futterverwertung & Futterkosten', '🌽', 'Futterverwertungsquotient und Kosten je kg Zuwachs', 'Berechne den Futterverwertungsquotienten (kg Futter / kg Zuwachs) je Mastdurchgang. Vergleiche mit den Stammdaten-Richtwerten. Leite daraus die Futterkosten je kg Lebendgewichtszuwachs ab und zeige Optimierungspotenzial.', 'schweine', 410),
      ('Umrauschrate & Fruchtbarkeit', '🐷', 'Umrauschrate, Abferkelrate und Wurfgröße', 'Analysiere die Fruchtbarkeitskennzahlen meiner Sauenherde: Umrauschrate, Abferkelrate und durchschnittliche Wurfgröße (lebend geborene Ferkel). Vergleiche mit Richtwerten und zeige Trends über die letzten Durchgänge.', 'schweine', 420),
      ('Abgänge & Verluste (Schweine)', '⚠️', 'Verluste nach Altersgruppe, Ursache und Zeitraum', 'Analysiere die Tierverluste der letzten 6 Monate: Aufschlüsselung nach Altersgruppe (Ferkel, Läufer, Mastschweine, Sauen), Verlustursachen als Kreisdiagramm und Trend. Gibt es kritische Häufungen oder saisonale Muster?', 'schweine', 430),
      ('Schlachtleistungs-Vergleich', '🏆', 'Schlachtgewicht, MFA und Auszahlungspreis je Partie', 'Vergleiche die Schlachtleistung meiner Mastpartien: Schlachtgewicht, Muskelfleischanteil (MFA), Handelsklassenverteilung und erzielter Auszahlungspreis. Welche Partien liegen über bzw. unter dem Durchschnitt? Zeige den Trend.', 'schweine', 440),
      ('Gasproduktions-Trend', '⚡', 'Gasproduktion der letzten 12 Monate', 'Zeige den Gasproduktions-Trend der letzten 12 Monate (m³/h). Identifiziere Einbrüche und prüfe Korrelation mit Substrat-Input.', 'biogas', 200),
      ('Methangehalt-Analyse', '🧪', 'Methangehalt-Verlauf und kritische Abweichungen', 'Analysiere den Methangehalt-Verlauf. Liegt er konstant über 52%? Gibt es kritische Abweichungen?', 'biogas', 210),
      ('Substrat-Effizienz', '🌽', 'Gasausbeute je Substratart und Zeitraum', 'Berechne die spezifische Gasausbeute je Substratart und Zeitraum. Welches Substrat liefert den höchsten Ertrag pro Tonne oTS?', 'biogas', 220),
      ('Betriebsstunden & Verfügbarkeit', '🔋', 'Ausfallzeiten und Verfügbarkeit der Anlage', 'Zeige Betriebsstunden, Ausfallzeiten und Verfügbarkeit der Anlage. Gibt es Häufungen bei Ausfällen?', 'biogas', 230),
      ('Gesamt-Performance-Überblick (Biogas)', '📊', 'Vollständiger Betriebsspiegel der Biogasanlage', 'Erstelle einen vollständigen Betriebsspiegel der Biogasanlage: alle Kern-KPIs, Vergleich mit Richtwerten, Top-3 Handlungsempfehlungen.', 'biogas', 240),
      ('Ertrags-Trend nach Kultur', '🌾', 'Erträge der letzten Jahre je Kulturart', 'Zeige Erträge (dt/ha) der letzten Jahre je Kulturart. Vergleiche mit den Stammdaten-Richtwerten.', 'ackerbau', 300),
      ('Flächenverteilung & Fruchtfolge', '🗺️', 'Flächenverteilung nach Kulturen und Fruchtfolgenbewertung', 'Zeige die aktuelle Flächenverteilung nach Kulturen als Kreisdiagramm. Bewerte die Fruchtfolge.', 'ackerbau', 310),
      ('Niederschlag vs. Ertrag', '💧', 'Zusammenhang Niederschlag und Erträge', 'Analysiere den Zusammenhang zwischen Niederschlag/Bewässerung und Erträgen. Gibt es kritische Trockenphasen?', 'ackerbau', 320),
      ('Deckungsbeiträge', '💰', 'Deckungsbeiträge je Kulturart', 'Berechne und vergleiche die Deckungsbeiträge (€/ha) je Kulturart. Welche Kultur ist wirtschaftlich am stärksten?', 'ackerbau', 330),
      ('Gesamt-Betriebsspiegel (Ackerbau)', '📊', 'Vollständiger Betriebsspiegel Ackerbau', 'Erstelle einen vollständigen Betriebsspiegel: alle Kern-KPIs, Vergleich Richtwerte, Top-3 Empfehlungen.', 'ackerbau', 340),
      ('Legeleistungs-Trend', '🥚', 'Tägliche Legeleistung je Herde und Zeitraum', 'Analysiere die tägliche Legeleistung (Eier/Henne/Tag) je Herde über den hochgeladenen Zeitraum. Zeige den Trend, identifiziere Einbrüche und vergleiche mit dem Richtwert aus den Stammdaten.', 'geflügel', 500),
      ('Futterverwertung Masthähnchen', '🌽', 'Futterverwertungsquotient und Kosten je kg Zuwachs (Broiler)', 'Berechne den Futterverwertungsquotienten (kg Futter / kg Zuwachs) je Mastdurchgang für Masthähnchen. Vergleiche mit Stammdaten-Richtwerten und zeige Optimierungspotenzial bei Futterkosten je kg Lebendgewicht.', 'geflügel', 510),
      ('Tierverluste & Abgangsursachen', '⚠️', 'Verluste nach Altersgruppe, Ursache und Trend', 'Analysiere die Tierverluste der letzten 6 Monate: Aufschlüsselung nach Alter/Nutzungsrichtung (Küken, Junghennen, Legehennen, Mastgeflügel), Verlustursachen als Kreisdiagramm und zeitlicher Trend. Gibt es kritische Häufungen oder saisonale Muster?', 'geflügel', 520),
      ('Stallklima & Erkrankungen', '🌡️', 'Klimaparameter und Zusammenhang mit Gesundheitsstörungen', 'Analysiere die Stallklimadaten (Temperatur, Luftfeuchtigkeit, NH₃-Werte) und setze sie in Beziehung zu Erkrankungs- und Verlustzahlen. Gibt es Schwellenwertüberschreitungen oder kritische Zeiträume?', 'geflügel', 530),
      ('Schlachtleistungsvergleich Geflügel', '🏆', 'Schlachtgewicht, Ausbeute und Auszahlungspreis je Partie', 'Vergleiche die Schlachtleistung meiner Mastpartien: Schlachtgewicht, Ausbeute (%), Klasseneinteilung und erzielter Auszahlungspreis. Welche Partien liegen über bzw. unter dem Durchschnitt? Zeige den Trend über die letzten Durchgänge.', 'geflügel', 540)
    `);
  } else {
    // Seed Biogas and Ackerbau templates if not yet present
    const { rows: biogasRows } = await pool.query(
      "SELECT COUNT(*)::int as c FROM analysis_templates WHERE category_tag = 'biogas'"
    );
    if ((biogasRows[0]?.c ?? 0) === 0) {
      await pool.query(`
        INSERT INTO analysis_templates (title, emoji, short_description, prompt_text, category_tag, sort_order) VALUES
        ('Gasproduktions-Trend', '⚡', 'Gasproduktion der letzten 12 Monate', 'Zeige den Gasproduktions-Trend der letzten 12 Monate (m³/h). Identifiziere Einbrüche und prüfe Korrelation mit Substrat-Input.', 'biogas', 200),
        ('Methangehalt-Analyse', '🧪', 'Methangehalt-Verlauf und kritische Abweichungen', 'Analysiere den Methangehalt-Verlauf. Liegt er konstant über 52%? Gibt es kritische Abweichungen?', 'biogas', 210),
        ('Substrat-Effizienz', '🌽', 'Gasausbeute je Substratart und Zeitraum', 'Berechne die spezifische Gasausbeute je Substratart und Zeitraum. Welches Substrat liefert den höchsten Ertrag pro Tonne oTS?', 'biogas', 220),
        ('Betriebsstunden & Verfügbarkeit', '🔋', 'Ausfallzeiten und Verfügbarkeit der Anlage', 'Zeige Betriebsstunden, Ausfallzeiten und Verfügbarkeit der Anlage. Gibt es Häufungen bei Ausfällen?', 'biogas', 230),
        ('Gesamt-Performance-Überblick (Biogas)', '📊', 'Vollständiger Betriebsspiegel der Biogasanlage', 'Erstelle einen vollständigen Betriebsspiegel der Biogasanlage: alle Kern-KPIs, Vergleich mit Richtwerten, Top-3 Handlungsempfehlungen.', 'biogas', 240)
      `);
    }
    const { rows: ackerbauRows } = await pool.query(
      "SELECT COUNT(*)::int as c FROM analysis_templates WHERE category_tag = 'ackerbau'"
    );
    if ((ackerbauRows[0]?.c ?? 0) === 0) {
      await pool.query(`
        INSERT INTO analysis_templates (title, emoji, short_description, prompt_text, category_tag, sort_order) VALUES
        ('Ertrags-Trend nach Kultur', '🌾', 'Erträge der letzten Jahre je Kulturart', 'Zeige Erträge (dt/ha) der letzten Jahre je Kulturart. Vergleiche mit den Stammdaten-Richtwerten.', 'ackerbau', 300),
        ('Flächenverteilung & Fruchtfolge', '🗺️', 'Flächenverteilung nach Kulturen und Fruchtfolgenbewertung', 'Zeige die aktuelle Flächenverteilung nach Kulturen als Kreisdiagramm. Bewerte die Fruchtfolge.', 'ackerbau', 310),
        ('Niederschlag vs. Ertrag', '💧', 'Zusammenhang Niederschlag und Erträge', 'Analysiere den Zusammenhang zwischen Niederschlag/Bewässerung und Erträgen. Gibt es kritische Trockenphasen?', 'ackerbau', 320),
        ('Deckungsbeiträge', '💰', 'Deckungsbeiträge je Kulturart', 'Berechne und vergleiche die Deckungsbeiträge (€/ha) je Kulturart. Welche Kultur ist wirtschaftlich am stärksten?', 'ackerbau', 330),
        ('Gesamt-Betriebsspiegel (Ackerbau)', '📊', 'Vollständiger Betriebsspiegel Ackerbau', 'Erstelle einen vollständigen Betriebsspiegel: alle Kern-KPIs, Vergleich Richtwerte, Top-3 Empfehlungen.', 'ackerbau', 340)
      `);
    }
    const { rows: schweineRows } = await pool.query(
      "SELECT COUNT(*)::int as c FROM analysis_templates WHERE category_tag = 'schweine'"
    );
    if ((schweineRows[0]?.c ?? 0) === 0) {
      await pool.query(`
        INSERT INTO analysis_templates (title, emoji, short_description, prompt_text, category_tag, sort_order) VALUES
        ('Tageszunahmen-Trend', '📈', 'Tägliche Zunahmen je Mastgruppe und Zeitraum', 'Analysiere die täglichen Gewichtszunahmen (g/Tag) je Mastgruppe über den hochgeladenen Zeitraum. Identifiziere Gruppen unter dem Richtwert, zeige den Trend als Diagramm und benenne mögliche Ursachen für Abweichungen.', 'schweine', 400),
        ('Futterverwertung & Futterkosten', '🌽', 'Futterverwertungsquotient und Kosten je kg Zuwachs', 'Berechne den Futterverwertungsquotienten (kg Futter / kg Zuwachs) je Mastdurchgang. Vergleiche mit den Stammdaten-Richtwerten. Leite daraus die Futterkosten je kg Lebendgewichtszuwachs ab und zeige Optimierungspotenzial.', 'schweine', 410),
        ('Umrauschrate & Fruchtbarkeit', '🐷', 'Umrauschrate, Abferkelrate und Wurfgröße', 'Analysiere die Fruchtbarkeitskennzahlen meiner Sauenherde: Umrauschrate, Abferkelrate und durchschnittliche Wurfgröße (lebend geborene Ferkel). Vergleiche mit Richtwerten und zeige Trends über die letzten Durchgänge.', 'schweine', 420),
        ('Abgänge & Verluste', '⚠️', 'Verluste nach Altersgruppe, Ursache und Zeitraum', 'Analysiere die Tierverluste der letzten 6 Monate: Aufschlüsselung nach Altersgruppe (Ferkel, Läufer, Mastschweine, Sauen), Verlustursachen als Kreisdiagramm und Trend. Gibt es kritische Häufungen oder saisonale Muster?', 'schweine', 430),
        ('Schlachtleistungs-Vergleich', '🏆', 'Schlachtgewicht, MFA und Auszahlungspreis je Partie', 'Vergleiche die Schlachtleistung meiner Mastpartien: Schlachtgewicht, Muskelfleischanteil (MFA), Handelsklassenverteilung und erzielter Auszahlungspreis. Welche Partien liegen über bzw. unter dem Durchschnitt? Zeige den Trend.', 'schweine', 440)
      `);
    }
    const { rows: geflügelRows } = await pool.query(
      "SELECT COUNT(*)::int as c FROM analysis_templates WHERE category_tag = 'geflügel'"
    );
    if ((geflügelRows[0]?.c ?? 0) === 0) {
      await pool.query(`
        INSERT INTO analysis_templates (title, emoji, short_description, prompt_text, category_tag, sort_order) VALUES
        ('Legeleistungs-Trend', '🥚', 'Tägliche Legeleistung je Herde und Zeitraum', 'Analysiere die tägliche Legeleistung (Eier/Henne/Tag) je Herde über den hochgeladenen Zeitraum. Zeige den Trend, identifiziere Einbrüche und vergleiche mit dem Richtwert aus den Stammdaten.', 'geflügel', 500),
        ('Futterverwertung Masthähnchen', '🌽', 'Futterverwertungsquotient und Kosten je kg Zuwachs (Broiler)', 'Berechne den Futterverwertungsquotienten (kg Futter / kg Zuwachs) je Mastdurchgang für Masthähnchen. Vergleiche mit Stammdaten-Richtwerten und zeige Optimierungspotenzial bei Futterkosten je kg Lebendgewicht.', 'geflügel', 510),
        ('Tierverluste & Abgangsursachen', '⚠️', 'Verluste nach Altersgruppe, Ursache und Trend', 'Analysiere die Tierverluste der letzten 6 Monate: Aufschlüsselung nach Alter/Nutzungsrichtung (Küken, Junghennen, Legehennen, Mastgeflügel), Verlustursachen als Kreisdiagramm und zeitlicher Trend. Gibt es kritische Häufungen oder saisonale Muster?', 'geflügel', 520),
        ('Stallklima & Erkrankungen', '🌡️', 'Klimaparameter und Zusammenhang mit Gesundheitsstörungen', 'Analysiere die Stallklimadaten (Temperatur, Luftfeuchtigkeit, NH₃-Werte) und setze sie in Beziehung zu Erkrankungs- und Verlustzahlen. Gibt es Schwellenwertüberschreitungen oder kritische Zeiträume?', 'geflügel', 530),
        ('Schlachtleistungsvergleich Geflügel', '🏆', 'Schlachtgewicht, Ausbeute und Auszahlungspreis je Partie', 'Vergleiche die Schlachtleistung meiner Mastpartien: Schlachtgewicht, Ausbeute (%), Klasseneinteilung und erzielter Auszahlungspreis. Welche Partien liegen über bzw. unter dem Durchschnitt? Zeige den Trend über die letzten Durchgänge.', 'geflügel', 540)
      `);
    }
  }
  // Migration: digest_opt_out column on users (EU law: DSGVO opt-out for monthly digest e-mails)
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_opt_out BOOLEAN NOT NULL DEFAULT FALSE"
  );
  // Migration: knowledge_missed_queries table for operator knowledge-gap analysis
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_missed_queries (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      query      TEXT        NOT NULL,
      top_score  TEXT,
      customer_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS knowledge_missed_queries_customer_idx ON knowledge_missed_queries (customer_id)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS knowledge_missed_queries_created_idx ON knowledge_missed_queries (created_at)"
  );

  // Migration: web_search_cache table for deduplicating external search calls
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS web_search_cache (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        query_hash TEXT        NOT NULL UNIQUE,
        query      TEXT        NOT NULL,
        results    JSONB       NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
      )
    `);
  } catch (err: any) {
    // 23505 = pg_type race: type name already exists (table created in prior run)
    if (err?.code !== "23505") throw err;
  }
  try {
    await pool.query(
      "CREATE INDEX IF NOT EXISTS web_search_cache_expires_idx ON web_search_cache (expires_at)"
    );
  } catch (err: any) {
    if (err?.code !== "23505") throw err;
  }

  // Seed default Biogas and Ackerbau master data if not yet present
  const { rows: biogasMd } = await pool.query(
    "SELECT COUNT(*)::int as c FROM master_data WHERE sector = 'biogas'"
  );
  if ((biogasMd[0]?.c ?? 0) === 0) {
    await pool.query(`
      INSERT INTO master_data (category, key, value, unit, notes, sector) VALUES
      ('Richtwerte', 'Methangehalt Zielwert', '52', '%', 'Mindest-Methangehalt für wirtschaftlichen Betrieb', 'biogas'),
      ('Richtwerte', 'Spezifische Gasausbeute Zielwert', '300', 'm³/t oTS', 'Mindestwert für spezifische Gasausbeute', 'biogas'),
      ('Richtwerte', 'Verfügbarkeit Zielwert', '95', '%', 'Anlagenverfügbarkeit als Zielwert', 'biogas'),
      ('Richtwerte', 'Wirkungsgrad elektrisch Zielwert', '38', '%', 'Elektrischer Wirkungsgrad BHKW', 'biogas')
    `);
  }
  const { rows: ackerbauMd } = await pool.query(
    "SELECT COUNT(*)::int as c FROM master_data WHERE sector = 'arable'"
  );
  if ((ackerbauMd[0]?.c ?? 0) === 0) {
    await pool.query(`
      INSERT INTO master_data (category, key, value, unit, notes, sector) VALUES
      ('Richtwerte', 'Weizen Ertrag Richtwert', '80', 'dt/ha', 'Regionaler Durchschnittsertrag Winterweizen', 'arable'),
      ('Richtwerte', 'Raps Ertrag Richtwert', '40', 'dt/ha', 'Regionaler Durchschnittsertrag Winterraps', 'arable'),
      ('Richtwerte', 'Mais Ertrag Richtwert', '400', 'dt/ha', 'Regionaler Durchschnittsertrag Silomais', 'arable'),
      ('Richtwerte', 'Gerste Ertrag Richtwert', '70', 'dt/ha', 'Regionaler Durchschnittsertrag Wintergerste', 'arable')
    `);
  }

  // Migration: Stripe billing tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id TEXT PRIMARY KEY,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      stripe_price_id TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      current_period_end TIMESTAMPTZ,
      grace_period_ends_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analysis_quota (
      user_id TEXT NOT NULL,
      year_month TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT analysis_quota_user_month_pk PRIMARY KEY (user_id, year_month)
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS analysis_quota_user_month_idx
    ON analysis_quota (user_id, year_month)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stripe_events (
      event_id TEXT PRIMARY KEY,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Migration: team invitations for Pro-plan users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_invites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      guest_email TEXT NOT NULL,
      guest_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      transition_ends_at TIMESTAMPTZ
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS team_invites_host_idx ON team_invites (host_user_id)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS team_invites_guest_user_idx ON team_invites (guest_user_id)"
  );
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS team_invites_token_idx ON team_invites (token)"
  );
  // Add constraints to existing team_invites table (idempotent)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'team_invites_status_check'
      ) THEN
        ALTER TABLE team_invites
          ADD CONSTRAINT team_invites_status_check CHECK (status IN ('pending', 'accepted', 'revoked'));
      END IF;
    END $$
  `);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'team_invites_host_user_id_fkey'
      ) THEN
        ALTER TABLE team_invites
          ADD CONSTRAINT team_invites_host_user_id_fkey
          FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    END $$
  `);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'team_invites_guest_user_id_fkey'
      ) THEN
        ALTER TABLE team_invites
          ADD CONSTRAINT team_invites_guest_user_id_fkey
          FOREIGN KEY (guest_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$
  `);
  // Migration: theme_preference column on users (syncs light/dark across devices)
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference TEXT"
  );
  // Migration: api_usage_log table for persisted prompt-cache metrics
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_usage_log (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      input_tokens          INTEGER     NOT NULL DEFAULT 0,
      output_tokens         INTEGER     NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER     NOT NULL DEFAULT 0,
      cache_read_tokens     INTEGER     NOT NULL DEFAULT 0,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS api_usage_log_created_idx ON api_usage_log (created_at)"
  );

  // Migration: cow_events table for livestock event CSV imports
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cow_events (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      dataset_id   UUID        NOT NULL,
      file_id      UUID        NOT NULL,
      animal_id    TEXT        NOT NULL,
      event_date   DATE        NOT NULL,
      event_type   TEXT        NOT NULL,
      dim          INTEGER,
      remark       TEXT,
      result       VARCHAR(4),
      technician   TEXT,
      raw_extra    JSONB,
      row_hash     TEXT        NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS cow_events_dataset_type_idx ON cow_events (dataset_id, event_type)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS cow_events_dataset_date_idx ON cow_events (dataset_id, event_date)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS cow_events_dataset_animal_idx ON cow_events (dataset_id, animal_id)"
  );
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS cow_events_dataset_hash_unique ON cow_events (dataset_id, row_hash)"
  );
  // Migration: document_type column on knowledge_documents (e.g. 'benchmark_reference')
  await pool.query(
    "ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS document_type TEXT"
  );
  // Seed: benchmark deviation factor in master_data (Systemeinstellungen)
  await pool.query(`
    INSERT INTO master_data (category, key, value, unit, notes, sector)
    SELECT 'Systemeinstellungen', 'benchmark_abweichungsfaktor', '5', '', 'Max/Min-Verhältnis-Schwellenwert für Benchmarkabweichungs-Warnung in Berichten (Standard: 5)', NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM master_data
      WHERE category = 'Systemeinstellungen'
        AND key = 'benchmark_abweichungsfaktor'
    )
  `);

  // Migration: is_shared column on analyses (explicit opt-in for public sharing)
  await pool.query(
    "ALTER TABLE analyses ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT false"
  );

  // Migration: beta_tool_logs table (tool call and escalation log for beta users)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS beta_tool_logs (
      id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id         UUID,
      analysis_id        UUID        NOT NULL,
      user_id            TEXT        NOT NULL,
      tool_name          TEXT        NOT NULL,
      key_params         JSONB,
      duration_ms        INTEGER,
      escalation_trigger TEXT,
      escalation_reason  TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS beta_tool_logs_analysis_idx ON beta_tool_logs (analysis_id)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS beta_tool_logs_message_idx ON beta_tool_logs (message_id) WHERE message_id IS NOT NULL"
  );

  // Migration: message_feedback table (beta user thumbs up/down per message)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_feedback (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id  UUID        NOT NULL,
      user_id     TEXT        NOT NULL,
      rating      TEXT        NOT NULL,
      comment     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS message_feedback_message_user_idx ON message_feedback (message_id, user_id)"
  );

  // Seed: beta quota limit in master_data (configurable via operator Stammdaten page)
  await pool.query(`
    INSERT INTO master_data (category, key, value, unit, notes, sector)
    SELECT 'Systemeinstellungen', 'beta_quota_monatlich', '200', 'Analysen/Monat',
           'Monatliches Analyse-Kontingent für Beta-Plan-Nutzer (Standard: 200)', NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM master_data WHERE key = 'beta_quota_monatlich'
    )
  `);

  // Migration: context_facts table — persistent, dataset-scoped farm context facts
  // extracted from chat (Task #375). Deliberately NOT granted to milchvieh_analyst.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS context_facts (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      dataset_id          UUID        NOT NULL,
      user_id             TEXT        NOT NULL,
      category            TEXT        NOT NULL DEFAULT 'sonstiges',
      fact_text           TEXT        NOT NULL,
      original_text       TEXT        NOT NULL,
      status              TEXT        NOT NULL DEFAULT 'vorgeschlagen',
      source_analysis_id  UUID,
      source_message_id   UUID,
      confirmed_by        TEXT,
      confirmed_at        TIMESTAMPTZ,
      embedding           vector(768),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS context_facts_dataset_idx ON context_facts (dataset_id, status)"
  );

  // Migration: context_facts_intro_seen_at — one-time explanation banner dismissal
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS context_facts_intro_seen_at TIMESTAMPTZ"
  );
}

/**
 * Set up the DB-level security sandbox for run_sql queries.
 *
 * Creates the `milchvieh_analyst` role (NOLOGIN, NOSUPERUSER, NOBYPASSRLS)
 * with SELECT only on `cow_events` and `data_rows`, plus RLS policies that
 * restrict every query to the dataset_id set via SET LOCAL before execution.
 *
 * Idempotent — safe to call on every server startup.
 *
 * NOTE: The role and RLS policies are ALSO defined in the Drizzle TypeScript
 * schema (analystRole in schema/analystRole.ts, pgPolicy entries in
 * schema/events.ts and schema/files.ts) so that Drizzle generates correct
 * production migrations (with full USING clause, in the right order).
 * The DO-blocks below serve as idempotent fallbacks and handle GRANT
 * statements that Drizzle cannot manage. If the `using` expression or role
 * definition changes, update BOTH the schema files and the blocks below.
 */
export async function setupAnalystSandbox(): Promise<void> {
  // 1. Create the restricted role — no login, no superuser, no RLS bypass
  await pool.query(`
    DO $$ BEGIN
      CREATE ROLE milchvieh_analyst NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  // 2. Allow the role to use the public schema and connect (required in PG 15+)
  await pool.query(`GRANT USAGE ON SCHEMA public TO milchvieh_analyst`);

  // 3. Grant SELECT only on the two allowed tables — nothing else
  await pool.query(`GRANT SELECT ON public.cow_events TO milchvieh_analyst`);
  await pool.query(`GRANT SELECT ON public.data_rows TO milchvieh_analyst`);

  // 4. Grant the role to the current app user so SET LOCAL ROLE works
  await pool.query(`
    DO $$ BEGIN
      GRANT milchvieh_analyst TO CURRENT_USER;
    EXCEPTION WHEN others THEN NULL;
    END $$
  `);

  // Migration: image_object_path on messages (chat image attachments, DSGVO-covered via dataset delete)
  await pool.query(
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_object_path TEXT"
  );

  // Migration: news_editions + dataset insights_summary columns
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_editions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      teaser TEXT,
      body_markdown TEXT,
      topic_badges JSONB,
      status TEXT NOT NULL DEFAULT 'draft',
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS news_editions_status_idx ON news_editions (status)`);
  await pool.query(`ALTER TABLE datasets ADD COLUMN IF NOT EXISTS insights_summary JSONB`);
  await pool.query(`ALTER TABLE datasets ADD COLUMN IF NOT EXISTS insights_summary_updated_at TIMESTAMPTZ`);

  // 5 + 6. RLS and dataset-isolation policies — PRODUCTION ONLY.
  //
  // The Replit deployment system diffs the Development DB directly against
  // Production (it does NOT read the TypeScript schema / drizzle-kit generate).
  // Drizzle's introspection of pg_policies loses the USING clause for
  // current_setting() expressions, producing broken migrations. Keeping RLS
  // and policies out of the Dev DB prevents any diff from being generated.
  //
  // In Development the analyst role still enforces SELECT-only access via
  // GRANTs above. Cross-tenant row isolation (dataset_id filter) is absent
  // in Dev — acceptable because Dev contains only single-developer test data.
  //
  // The same definitions also exist in the Drizzle TypeScript schema
  // (schema/analystRole.ts, schema/events.ts, schema/files.ts) as forward-
  // compatibility for if Replit ever switches to schema-based migrations.
  if (process.env.NODE_ENV === "production") {
    // Enable RLS — table owners bypass by default, so app queries are unaffected.
    await pool.query(`ALTER TABLE public.cow_events ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE public.data_rows ENABLE ROW LEVEL SECURITY`);

    // Dataset-isolation policies: current_setting() returns NULL when not set
    // → zero rows returned by default (safe for un-sandboxed connections).
    await pool.query(`
      DO $$ BEGIN
        CREATE POLICY analyst_cow_events_isolation ON public.cow_events
          FOR SELECT
          TO milchvieh_analyst
          USING (dataset_id::text = current_setting('app.current_dataset_id', true));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await pool.query(`
      DO $$ BEGIN
        CREATE POLICY analyst_data_rows_isolation ON public.data_rows
          FOR SELECT
          TO milchvieh_analyst
          USING (dataset_id::text = current_setting('app.current_dataset_id', true));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  // Migration: news_topics — operator-managed topic rotation list
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_topics (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT        NOT NULL,
      color       TEXT        NOT NULL DEFAULT 'blue',
      source_urls JSONB       NOT NULL DEFAULT '[]',
      sort_order  INTEGER     NOT NULL DEFAULT 0,
      active      BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Migration: newsletter_editions — AI-generated weekly batch editions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS newsletter_editions (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      scheduled_date DATE        NOT NULL,
      topic          TEXT        NOT NULL,
      topic_color    TEXT        NOT NULL DEFAULT 'blue',
      topic_id       UUID,
      title          TEXT        NOT NULL,
      app_body       TEXT        NOT NULL,
      social_body    TEXT        NOT NULL,
      sources        JSONB       NOT NULL DEFAULT '[]',
      cta_type       TEXT        NOT NULL DEFAULT 'chat_prompt',
      cta_target     TEXT        NOT NULL DEFAULT '',
      status         TEXT        NOT NULL DEFAULT 'draft',
      batch_run_at   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS newsletter_editions_status_idx ON newsletter_editions (status)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS newsletter_editions_scheduled_date_idx ON newsletter_editions (scheduled_date)"
  );
  // Deduplicate any existing rows with the same scheduled_date (keep newest by created_at)
  await pool.query(`
    DELETE FROM newsletter_editions
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY scheduled_date ORDER BY created_at DESC) AS rn
        FROM newsletter_editions
      ) sub
      WHERE rn > 1
    )
  `);
  // Enforce one edition per date at DB level (prevents race-condition duplicates)
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS newsletter_editions_scheduled_date_unique ON newsletter_editions (scheduled_date)"
  );

  // Migration: semen_planning table — stores Besamungs- & Sperma-Kostenplanung per farm/dataset
  await pool.query(`
    CREATE TABLE IF NOT EXISTS semen_planning (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      dataset_id  UUID        NOT NULL UNIQUE,
      user_id     TEXT        NOT NULL,
      inputs      JSONB       NOT NULL,
      outputs     JSONB       NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS semen_planning_dataset_id_idx ON semen_planning (dataset_id)"
  );

  // Migration: farm_diary_entries table — per-farmer operational event log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS farm_diary_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      analysis_id UUID,
      entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
      category TEXT NOT NULL CHECK (category IN ('feed','infrastructure','health','management','weather','other')),
      description TEXT NOT NULL,
      reminder_days INTEGER,
      reminder_due_at TIMESTAMPTZ,
      reminded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS farm_diary_userid_idx ON farm_diary_entries (user_id)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS farm_diary_reminder_idx ON farm_diary_entries (reminder_due_at) WHERE reminded_at IS NULL"
  );
  // Migration: logged_event JSONB on messages (diary entry captured per message)
  await pool.query(
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS logged_event JSONB"
  );

  // Seed default news topics if table is empty
  const { rows: topicRows } = await pool.query(
    "SELECT COUNT(*)::int AS c FROM news_topics"
  );
  if ((topicRows[0]?.c ?? 0) === 0) {
    await pool.query(`
      INSERT INTO news_topics (name, color, source_urls, sort_order) VALUES
      ('Eutergesundheit',     'blue',   '[]', 10),
      ('Fruchtbarkeit',       'green',  '[]', 20),
      ('Fütterung',           'amber',  '[]', 30),
      ('Klauengesundheit',    'purple', '["https://thedairylandinitiative.vetmed.wisc.edu/lifestep-lameness/locomotion-scoring/","https://dairy.extension.wisc.edu/article-topic/animal-welfare-herd-health/"]', 40),
      ('Hitzestress',         'rose',   '["https://dairy.extension.wisc.edu/heat-stress/"]', 50),
      ('Technik/Digitalisierung', 'cyan','["https://dairy.extension.wisc.edu/article-topic/emerging-technologies-and-facilities/"]', 60)
    `);
  }
}

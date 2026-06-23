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
  // Performance: HNSW vector index for fast cosine similarity search on knowledge chunks
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
}

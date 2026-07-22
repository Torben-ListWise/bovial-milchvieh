import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  real,
  index,
} from "drizzle-orm/pg-core";

/**
 * Betriebsübergreifende Erfolgsmuster-Empfehlungen.
 *
 * Ablauf:
 *   1. Wöchentlicher Batch-Job identifiziert statistische Auffälligkeiten
 *      bei opt-in-Betrieben (KPI-Sprünge + zeitlich nahe Betriebsänderungen).
 *   2. Kandidaten landen mit status='pending' hier.
 *   3. Operator (Torben) prüft fachlich und formuliert finale Musteraussage.
 *   4. Nach Freigabe (status='approved') erscheinen Muster für opt-in-Nutzer.
 *
 * Datenschutz:
 *   - Keine Betriebsnamen, keine exakten Einzelwerte, keine Rohdaten.
 *   - Nur aggregierte statistische Beobachtungen.
 *   - Nur Nutzer mit pattern_sharing_opted_in=true im users-Datensatz.
 *
 * ⚠️  RECHTSHINWEIS: Der finale Einwilligungstext und die Musteraussagen müssen
 *     vor dem Livegang durch einen DSGVO-Anwalt geprüft werden (Einwilligung für
 *     Datennutzung über den ursprünglichen Vertragszweck hinaus).
 */
export const crossFarmPatternsTable = pgTable(
  "cross_farm_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** KPI-Name: 'konzeptionsrate' | 'thi_score' | 'zwischenkalbezeit' | ... */
    kpiName: text("kpi_name").notNull(),

    /**
     * Beschreibung der erkannten Veränderung (aus context_facts oder
     * automatisch generiert). NULL wenn keine kontextuelle Erklärung verfügbar.
     */
    changeDescription: text("change_description"),

    /** Durchschnittlicher Ausgangswert (vor Veränderung) über alle Betriebe */
    baselineValue: real("baseline_value"),

    /** Durchschnittlicher Wert nach Veränderung */
    afterValue: real("after_value"),

    /** Verbesserung: afterValue - baselineValue */
    avgImprovement: real("avg_improvement"),

    /** Anzahl Betriebe, die dieses Muster zeigen */
    sampleSize: integer("sample_size").notNull().default(1),

    /** Beobachtungszeitraum in Monaten */
    observationPeriodMonths: integer("observation_period_months"),

    /**
     * Deduplizierungsschlüssel — verhindert, dass derselbe Fund beim nächsten
     * Batch-Lauf erneut als Kandidat angelegt wird.
     */
    extractionHash: text("extraction_hash"),

    /**
     * Operator-formulierte finale Musteraussage für Nutzer.
     * Vollständig anonymisiert, als statistische Beobachtung formuliert.
     * Wird vom Operator vor der Freigabe eingetragen/bearbeitet.
     *
     * Beispiel: "Betriebe mit ähnlichem Ausgangsniveau, die eine Maßnahme
     * zur Hitzestress-Reduktion eingeführt haben, zeigten häufig eine
     * Verbesserung der Konzeptionsrate um Ø +8 Prozentpunkte innerhalb
     * von 3 Monaten. Statistische Beobachtung, keine nachgewiesene Kausalität."
     */
    patternStatement: text("pattern_statement"),

    /** Kurz-Schlüssel für Kategorisierung, z.B. 'hitze_kr_sommer' */
    patternKey: text("pattern_key"),

    /** Relevanz-Tags für Matching (z.B. ['milchvieh','konzeptionsrate','sommer']) */
    relevanceTags: text("relevance_tags").array(),

    /** Operator-interne Notizen zur fachlichen Einschätzung */
    reviewNotes: text("review_notes"),

    /** 'pending' | 'approved' | 'rejected' */
    status: text("status").notNull().default("pending"),

    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("cross_farm_patterns_status_idx").on(table.status, table.createdAt),
    index("cross_farm_patterns_kpi_idx").on(table.kpiName, table.status),
    index("cross_farm_patterns_hash_idx").on(table.extractionHash),
  ],
);

export type CrossFarmPattern = typeof crossFarmPatternsTable.$inferSelect;
export type InsertCrossFarmPattern = typeof crossFarmPatternsTable.$inferInsert;

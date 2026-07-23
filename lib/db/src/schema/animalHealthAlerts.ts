import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

/**
 * Amtliche Tierseuchen- und Gesundheitswarnungen.
 *
 * Ablauf:
 *   1. Scheduled fetcher legt neue Meldungen mit status='pending' an.
 *   2. Operator bestätigt (approved) oder lehnt ab (rejected).
 *   3. Nach Bestätigung erscheint die Meldung im Kunden-Dashboard.
 *   4. Pro topic wird nur die neueste bestätigte Meldung angezeigt.
 *
 * Quellen (sourceKey):
 *   fli        — Friedrich-Loeffler-Institut (bundesweit)
 *   laves_nds  — LAVES Niedersachsen (regional)
 */
export const animalHealthAlertsTable = pgTable(
  "animal_health_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Quell-Identifier: 'fli' | 'laves_nds' | ... (erweiterbar) */
    sourceKey: text("source_key").notNull(),

    /**
     * Deduplizierungsschlüssel innerhalb derselben Quelle.
     * Typischerweise ein Hash aus URL + Datum, damit wiederholte
     * Fetches keine Duplikate erzeugen.
     */
    externalId: text("external_id").notNull(),

    /**
     * Themen-Schlüssel für Überschreibungslogik (z. B. "BTV-8", "MKS").
     * Eine neue bestätigte Meldung zum gleichen topic ersetzt die vorherige
     * im Dashboard; die Historie bleibt vollständig erhalten.
     */
    topic: text("topic").notNull(),

    /** Überschrift der Meldung */
    title: text("title").notNull(),

    /** Kurzzusammenfassung (1-3 Sätze) */
    summary: text("summary").notNull(),

    /** URL zur amtlichen Originalquelle */
    sourceUrl: text("source_url").notNull(),

    /** Datum der amtlichen Meldung (YYYY-MM-DD, aus Quelle extrahiert) */
    officialDate: text("official_date"),

    /**
     * Betroffene Tierarten — entsprechen focus_area-Schlüsseln.
     * Default: ['allgemein'] = wird allen Betriebstypen angezeigt.
     */
    affectedSpecies: text("affected_species").array().notNull().default(["allgemein"]),

    /** Zeitpunkt des Fetches */
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** 'pending' | 'approved' | 'rejected' */
    status: text("status").notNull().default("pending"),

    /** Wer hat bestätigt/abgelehnt */
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
    index("animal_health_alerts_status_idx").on(table.status, table.createdAt),
    index("animal_health_alerts_source_idx").on(table.sourceKey, table.externalId),
    index("animal_health_alerts_topic_idx").on(table.topic, table.status),
  ],
);

export type AnimalHealthAlert = typeof animalHealthAlertsTable.$inferSelect;
export type InsertAnimalHealthAlert = typeof animalHealthAlertsTable.$inferInsert;

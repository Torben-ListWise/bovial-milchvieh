import {
  pgTable,
  text,
  uuid,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Wissens-Katalog bekannter Tierseuchen.
 *
 * Jeder Eintrag beschreibt eine Krankheit mit Übertragungsweg, Symptomen,
 * Prävention und den betroffenen Tierarten.
 *
 * affectedSpecies-Werte entsprechen den focus_area-Schlüsseln der users-Tabelle:
 *   milchvieh | schweine | geflügel | ackerbau | allgemein
 */
export const diseaseCatalogTable = pgTable("disease_catalog", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Eindeutiger Schlüssel (z. B. "MKS", "BTV") — entspricht topic in animal_health_alerts */
  topicKey: text("topic_key").notNull().unique(),

  /** Anzeigename der Krankheit */
  name: text("name").notNull(),

  /** Kurze allgemeine Beschreibung */
  description: text("description").notNull().default(""),

  /** Übertragungsweg */
  transmission: text("transmission").notNull().default(""),

  /** Typische Symptome */
  symptoms: text("symptoms").notNull().default(""),

  /** Präventionsmaßnahmen */
  prevention: text("prevention").notNull().default(""),

  /**
   * Betroffene Tierarten (focus_area-Schlüssel).
   * ['allgemein'] = gilt für alle Betriebstypen.
   */
  affectedSpecies: text("affected_species").array().notNull().default(["allgemein"]),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DiseaseCatalogEntry = typeof diseaseCatalogTable.$inferSelect;
export type InsertDiseaseCatalogEntry = typeof diseaseCatalogTable.$inferInsert;

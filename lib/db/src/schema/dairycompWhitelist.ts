import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const dairycompCommandWhitelistTable = pgTable("dairycomp_command_whitelist", {
  id: uuid("id").primaryKey().defaultRandom(),
  befehl: text("befehl").notNull(),
  befehlsfamilie: text("befehlsfamilie").notNull(),
  beschreibung: text("beschreibung"),
  kategorie: text("kategorie"),
  benoetigtZeitraum: boolean("benoetigt_zeitraum").notNull().default(false),
  benoetigtJungrinderFilter: boolean("benoetigt_jungrinder_filter").notNull().default(false),
  quelleReferenz: text("quelle_referenz"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

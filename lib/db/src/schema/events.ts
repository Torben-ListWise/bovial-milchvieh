import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  date,
  index,
  unique,
  varchar,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { analystRole } from "./analystRole";

export const cowEventsTable = pgTable(
  "cow_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id").notNull(),
    fileId: uuid("file_id").notNull(),
    animalId: text("animal_id").notNull(),
    eventDate: date("event_date").notNull(),
    eventType: text("event_type").notNull(),
    dim: integer("dim"),
    remark: text("remark"),
    result: varchar("result", { length: 4 }),
    technician: text("technician"),
    rawExtra: jsonb("raw_extra"),
    rowHash: text("row_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("cow_events_dataset_type_idx").on(table.datasetId, table.eventType),
    index("cow_events_dataset_date_idx").on(table.datasetId, table.eventDate),
    index("cow_events_dataset_animal_idx").on(table.datasetId, table.animalId),
    unique("cow_events_dataset_hash_unique").on(table.datasetId, table.rowHash),
    // IMPORTANT — NOT used by the current Replit deployment system.
    //
    // The Replit Provision step diffs the Development DB directly against
    // Production; it does NOT read this TypeScript schema. The actual source
    // of truth for this policy is setupAnalystSandbox() in migrate.ts (runs
    // production-only to prevent the Dev DB diff from generating broken SQL).
    // This pgPolicy definition is forward-compatibility only — kept here in
    // case Replit switches to schema-based migrations. If the `using` expression
    // changes, update setupAnalystSandbox() in migrate.ts as the primary place.
    pgPolicy("analyst_cow_events_isolation", {
      as: "permissive",
      for: "select",
      to: analystRole,
      using: sql`dataset_id::text = current_setting('app.current_dataset_id', true)`,
    }),
  ]
).enableRLS();

export interface EventImportSummary {
  inserted: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  topEvents: { type: string; count: number }[];
  dateRange: { from: string; to: string } | null;
  animals: number;
}

export type CowEvent = typeof cowEventsTable.$inferSelect;
export type InsertCowEvent = typeof cowEventsTable.$inferInsert;

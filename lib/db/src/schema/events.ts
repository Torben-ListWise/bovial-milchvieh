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
} from "drizzle-orm/pg-core";

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
  ],
);

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

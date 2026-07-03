import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

export const semenPlanningTable = pgTable("semen_planning", {
  id: uuid("id").primaryKey().defaultRandom(),
  datasetId: uuid("dataset_id").notNull().unique(),
  userId: text("user_id").notNull(),
  inputs: jsonb("inputs").notNull(),
  outputs: jsonb("outputs").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SemenPlanning = typeof semenPlanningTable.$inferSelect;
export type InsertSemenPlanning = typeof semenPlanningTable.$inferInsert;

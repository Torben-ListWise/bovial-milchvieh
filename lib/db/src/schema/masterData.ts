import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const masterDataTable = pgTable("master_data", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: text("category").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  unit: text("unit"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MasterDataEntry = typeof masterDataTable.$inferSelect;
export type InsertMasterDataEntry = typeof masterDataTable.$inferInsert;

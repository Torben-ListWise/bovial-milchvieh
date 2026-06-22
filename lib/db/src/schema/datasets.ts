import {
  pgTable,
  text,
  timestamp,
  uuid,
  date,
} from "drizzle-orm/pg-core";

export const datasetsTable = pgTable("datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("empty"),
  sector: text("sector").notNull().default("dairy"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Dataset = typeof datasetsTable.$inferSelect;
export type InsertDataset = typeof datasetsTable.$inferInsert;

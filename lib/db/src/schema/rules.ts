import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  doublePrecision,
} from "drizzle-orm/pg-core";

export const rulesTable = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  metric: text("metric").notNull(),
  comparator: text("comparator"),
  threshold: doublePrecision("threshold"),
  unit: text("unit"),
  severity: text("severity").default("warning"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Rule = typeof rulesTable.$inferSelect;
export type InsertRule = typeof rulesTable.$inferInsert;

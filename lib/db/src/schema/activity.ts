import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

export const activityLogTable = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    category: text("category"),
    datasetRef: text("dataset_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("activity_log_created_idx").on(table.createdAt)],
);

export type ActivityLog = typeof activityLogTable.$inferSelect;
export type InsertActivityLog = typeof activityLogTable.$inferInsert;

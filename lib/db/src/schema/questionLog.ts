import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const questionLogTable = pgTable(
  "question_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id").notNull(),
    userId: text("user_id").notNull(),
    questionText: text("question_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("question_log_dataset_idx").on(table.datasetId),
    index("question_log_created_idx").on(table.createdAt),
  ],
);

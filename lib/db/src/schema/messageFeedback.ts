import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const messageFeedbackTable = pgTable(
  "message_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id").notNull(),
    userId: text("user_id").notNull(),
    rating: text("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("message_feedback_message_user_idx").on(t.messageId, t.userId),
  ],
);

export type MessageFeedback = typeof messageFeedbackTable.$inferSelect;
export type InsertMessageFeedback = typeof messageFeedbackTable.$inferInsert;

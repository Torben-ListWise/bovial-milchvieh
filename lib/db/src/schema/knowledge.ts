import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  index,
  customType,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config?: { dimensions?: number }) {
    return config?.dimensions ? `vector(${config.dimensions})` : "vector";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map(Number);
  },
});

export const knowledgeDocumentsTable = pgTable("knowledge_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  fileType: text("file_type").notNull(),
  objectPath: text("object_path").notNull(),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  chunkCount: integer("chunk_count"),
  size: integer("size"),
  sourceUrl: text("source_url"),
  embeddingModel: text("embedding_model"),
  category: text("category"),
  documentType: text("document_type"),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const knowledgeChunksTable = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docId: uuid("doc_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
  },
  (table) => [
    index("knowledge_chunks_doc_idx").on(table.docId, table.chunkIndex),
    index("knowledge_chunks_embedding_hnsw_idx")
      .using("hnsw", sql`${table.embedding} vector_cosine_ops`)
      .with({ m: 16, ef_construction: 64 }),
  ],
);

export const knowledgeMissedQueriesTable = pgTable(
  "knowledge_missed_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    query: text("query").notNull(),
    topScore: text("top_score"),
    customerId: text("customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("knowledge_missed_queries_customer_idx").on(table.customerId),
    index("knowledge_missed_queries_created_idx").on(table.createdAt),
  ],
);

export type KnowledgeDocument = typeof knowledgeDocumentsTable.$inferSelect;
export type InsertKnowledgeDocument =
  typeof knowledgeDocumentsTable.$inferInsert;
export type KnowledgeChunk = typeof knowledgeChunksTable.$inferSelect;
export type InsertKnowledgeChunk = typeof knowledgeChunksTable.$inferInsert;
export type KnowledgeMissedQuery =
  typeof knowledgeMissedQueriesTable.$inferSelect;
export type InsertKnowledgeMissedQuery =
  typeof knowledgeMissedQueriesTable.$inferInsert;

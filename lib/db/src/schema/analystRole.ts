import { pgRole } from "drizzle-orm/pg-core";

// milchvieh_analyst: restricted read-only role for the run_sql agent sandbox.
//
// Defined here so Drizzle includes CREATE ROLE in production migrations
// before any pgPolicy that references this role. The role is also created
// at server startup inside setupAnalystSandbox() (lib/db/src/migrate.ts),
// which handles GRANT statements and role membership that Drizzle cannot
// manage. If the role definition changes, update both places.
export const analystRole = pgRole("milchvieh_analyst");

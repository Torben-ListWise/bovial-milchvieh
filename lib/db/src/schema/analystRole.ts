import { pgRole } from "drizzle-orm/pg-core";

// IMPORTANT — NOT used by the current Replit deployment system.
//
// The Replit Provision step diffs the Development database directly against
// Production. It does NOT read this TypeScript schema or run drizzle-kit
// generate to produce migration files. The actual source of truth for the
// milchvieh_analyst role is setupAnalystSandbox() in lib/db/src/migrate.ts,
// which runs at every server startup.
//
// This definition remains as forward-compatibility in case Replit switches to
// a schema-based migration flow in the future. If the role name or options
// change, update setupAnalystSandbox() in migrate.ts as the primary location.
export const analystRole = pgRole("milchvieh_analyst");

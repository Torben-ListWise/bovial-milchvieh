#!/usr/bin/env tsx
/**
 * configure-clerk-allowed-origins.ts
 *
 * Idempotent reconcile script: ensures Clerk's allowed_origins list contains
 * exactly the domains in REQUIRED_ORIGINS and none of the domains in
 * BANNED_ORIGINS.
 *
 * Why not additive-only?  An additive script cannot clean up stale entries.
 * This script reads the live list, computes the desired state, and only writes
 * if a change is required.
 *
 * REQUIRED domains
 * ────────────────
 * https://bovial.com — the canonical production origin.
 *
 * BANNED domains (must be absent)
 * ────────────────────────────────
 * https://www.bovial.com — the www subdomain is redirected to the apex domain
 * via a server-level 301 before any Clerk interaction.  Keeping it in
 * allowed_origins would be stale config that could confuse future debugging
 * or allow a misconfigured client to complete an auth flow on the wrong domain.
 *
 * HOW TO RUN
 * ==========
 *   pnpm --filter @workspace/api-server tsx src/scripts/configure-clerk-allowed-origins.ts
 *
 * PREREQUISITES
 * =============
 * - CLERK_SECRET_KEY must be set in the environment (available in both the
 *   Replit workspace and on the production server as a secret / env var).
 * - Run from the project root or inside the api-server artifact directory.
 *
 * SAFETY
 * ======
 * - Reads current allowed_origins first; only PATCHes when a change is needed.
 * - Idempotent: safe to run multiple times.
 * - Does NOT touch any other instance settings — only allowed_origins.
 */

const CLERK_API_BASE = "https://api.clerk.com/v1";

const REQUIRED_ORIGINS = new Set(["https://bovial.com"]);

const BANNED_ORIGINS = new Set([
  "https://www.bovial.com",
]);

async function clerkFetch(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "CLERK_SECRET_KEY is not set. Export it before running this script.",
    );
  }

  const url = `${CLERK_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Clerk API error ${res.status} ${res.statusText}: ${text}`,
    );
  }
  return text ? JSON.parse(text) : {};
}

async function main(): Promise<void> {
  console.log("=== configure-clerk-allowed-origins ===\n");

  console.log("1. Fetching current Clerk instance settings…");
  const instance = (await clerkFetch("/instance")) as {
    allowed_origins?: string[];
  };

  const current: string[] = instance.allowed_origins ?? [];
  console.log(`   Current allowed_origins: ${JSON.stringify(current)}`);

  // Compute desired state: keep non-banned existing entries, add any missing required ones.
  const desired = [
    ...current.filter((d) => !BANNED_ORIGINS.has(d)),
    ...[...REQUIRED_ORIGINS].filter((d) => !current.includes(d)),
  ];

  const toAdd = desired.filter((d) => !current.includes(d));
  const toRemove = current.filter((d) => !desired.includes(d));

  if (toAdd.length === 0 && toRemove.length === 0) {
    console.log("\n✅ allowed_origins already matches desired state — nothing to do.");
    console.log(`   Desired: ${JSON.stringify(desired)}`);
    return;
  }

  if (toAdd.length > 0) {
    console.log(`\n   Adding:   ${JSON.stringify(toAdd)}`);
  }
  if (toRemove.length > 0) {
    console.log(`   Removing: ${JSON.stringify(toRemove)}`);
  }
  console.log(`\n2. Applying new allowed_origins: ${JSON.stringify(desired)}`);

  await clerkFetch("/instance", {
    method: "PATCH",
    body: JSON.stringify({ allowed_origins: desired }),
  });

  console.log("\n✅ Clerk instance updated successfully.");
}

main().catch((err) => {
  console.error("\n❌ Script failed:", err.message);
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * configure-clerk-allowed-origins.ts
 *
 * Idempotent one-time script: adds https://bovial.com and
 * https://www.bovial.com to the Clerk instance's allowed_origins list.
 *
 * Clerk's security policy requires every origin that can host the app to be
 * explicitly whitelisted. Without this, browser requests from bovial.com to
 * Clerk's Frontend API are rejected with a 401 / CORS-style auth error even
 * though the Express CORS allowlist (ALLOWED_ORIGINS env var) is configured
 * correctly.
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
 * - Reads current allowed_origins first; merges bovial.com entries without
 *   removing any existing values.
 * - Idempotent: safe to run multiple times; re-running when the origins are
 *   already present is a no-op.
 */

const CLERK_API_BASE = "https://api.clerk.com/v1";
const DOMAINS_TO_ADD = ["https://bovial.com", "https://www.bovial.com"];

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

  const toAdd = DOMAINS_TO_ADD.filter((d) => !current.includes(d));
  if (toAdd.length === 0) {
    console.log("\n✅ All required origins are already present — nothing to do.");
    return;
  }

  const updated = [...current, ...toAdd];
  console.log(`\n2. Adding: ${JSON.stringify(toAdd)}`);
  console.log(`   New allowed_origins will be: ${JSON.stringify(updated)}`);

  await clerkFetch("/instance", {
    method: "PATCH",
    body: JSON.stringify({ allowed_origins: updated }),
  });

  console.log("\n✅ Clerk instance updated successfully.");
  console.log(
    "   bovial.com and www.bovial.com are now in Clerk's allowed_origins.",
  );
}

main().catch((err) => {
  console.error("\n❌ Script failed:", err.message);
  process.exit(1);
});

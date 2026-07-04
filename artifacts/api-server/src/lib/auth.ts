import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import { sendWelcome, fireEmail } from "./emailService";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      appUser?: User;
    }
  }
}

const OPERATOR_EMAILS = (process.env.OPERATOR_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function provisionUser(clerkUserId: string): Promise<User> {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, clerkUserId));
  if (existing[0]) return existing[0];

  let email: string | null = null;
  let name: string | null = null;
  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    email =
      clerkUser.primaryEmailAddress?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      null;
    const fullName = [clerkUser.firstName, clerkUser.lastName]
      .filter(Boolean)
      .join(" ");
    name = fullName || clerkUser.username || null;
  } catch {
    // Clerk lookup failed; provision with minimal info.
  }

  const isOperator =
    email != null && OPERATOR_EMAILS.includes(email.toLowerCase());

  const [created] = await db
    .insert(usersTable)
    .values({
      id: clerkUserId,
      email,
      name,
      role: isOperator ? "operator" : "customer",
    })
    .onConflictDoNothing()
    .returning();

  if (created) {
    if (created.email) {
      fireEmail(sendWelcome(created.email, created.name), `welcome:${created.id}`);
    }
    return created;
  }
  const again = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, clerkUserId));
  return again[0];
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Dev-only bypass: Bearer dev-bypass-<userId> skips Clerk JWT verification.
  // Only active when NODE_ENV=development AND DEV_BYPASS_USER_ID is set.
  if (process.env.NODE_ENV === "development") {
    const devBypassUserId = process.env.DEV_BYPASS_USER_ID;
    if (devBypassUserId) {
      const authHeader = req.headers["authorization"];
      if (authHeader === `Bearer dev-bypass-${devBypassUserId}`) {
        const user = await provisionUser(devBypassUserId);
        req.userId = user.id;
        req.appUser = user;
        next();
        return;
      }
    }
  }

  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return;
  }
  let user = await provisionUser(clerkUserId);

  // Security: sync operator role on every auth so OPERATOR_EMAILS changes
  // take effect immediately without requiring a DB update.
  // Only sync when OPERATOR_EMAILS is explicitly configured; if the list is
  // empty we treat the DB-stored role as authoritative (avoids demoting
  // operators in dev environments where the env var is not set).
  if (user.email && OPERATOR_EMAILS.length > 0) {
    const shouldBeOperator = OPERATOR_EMAILS.includes(user.email.toLowerCase());
    const isOperator = user.role === "operator";
    if (shouldBeOperator !== isOperator) {
      const newRole = shouldBeOperator ? "operator" : "customer";
      const [updated] = await db
        .update(usersTable)
        .set({ role: newRole })
        .where(eq(usersTable.id, user.id))
        .returning();
      if (updated) user = updated;
    }
  }

  req.userId = user.id;
  req.appUser = user;
  next();
}

export function requireOperator(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.appUser?.role !== "operator") {
    res.status(403).json({ error: "Nur für Betreiber zugänglich" });
    return;
  }
  next();
}

import { Router, type IRouter, type Request, type Response } from "express";
import { GetCurrentUserResponse } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

function serializeUser(u: typeof usersTable.$inferSelect) {
  const tp = (u as any).themePreference;
  return GetCurrentUserResponse.parse({
    id: u.id,
    email: u.email ?? null,
    name: u.name ?? null,
    role: u.role === "operator" ? "operator" : "customer",
    focusAreas: (u as any).focusAreas ?? null,
    onboardingCompletedAt: (u as any).onboardingCompletedAt
      ? new Date((u as any).onboardingCompletedAt).toISOString()
      : null,
    themePreference: tp === "light" || tp === "dark" ? tp : null,
    contextFactsIntroSeenAt: (u as any).contextFactsIntroSeenAt
      ? new Date((u as any).contextFactsIntroSeenAt).toISOString()
      : null,
  });
}

router.get("/me", requireAuth, (req: Request, res: Response) => {
  const u = req.appUser!;
  res.json(serializeUser(u as any));
});

const ALLOWED_FOCUS_AREAS = [
  "milchvieh",
  "schweine",
  "geflügel",
  "ackerbau",
  "mischbetrieb",
  "sonstiges",
] as const;

const UpdateMeBodySchema = z.object({
  focusAreas: z
    .array(z.enum(ALLOWED_FOCUS_AREAS))
    .nullable()
    .optional(),
  themePreference: z.enum(["light", "dark"]).nullable().optional(),
  markContextFactsIntroSeen: z.boolean().optional(),
});

router.patch("/me", requireAuth, async (req: Request, res: Response) => {
  const parsed = UpdateMeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }

  const { focusAreas, themePreference, markContextFactsIntroSeen } = parsed.data;

  const updateFields: Record<string, unknown> = {};
  if (focusAreas !== undefined) updateFields.focusAreas = focusAreas ?? null;
  if (themePreference !== undefined) updateFields.themePreference = themePreference ?? null;
  if (markContextFactsIntroSeen) updateFields.contextFactsIntroSeenAt = new Date();

  const [updated] = await db
    .update(usersTable)
    .set(updateFields as any)
    .where(eq(usersTable.id, req.userId!))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Nutzer nicht gefunden" });
    return;
  }

  res.json(serializeUser(updated as any));
});

export default router;

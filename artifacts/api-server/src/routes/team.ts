import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { getSubscription } from "../lib/quota";
import { countActiveInvites, getActiveHostIds } from "../lib/teamAccess";
import { z } from "zod";

const router: IRouter = Router();

const MAX_TEAM_SLOTS = 3;
const INVITE_VALID_DAYS = 7;
const GRACE_DAYS = 30;

const CreateInviteBody = z.object({
  guestEmail: z.string().email(),
});

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ── GET /api/team/invites — list host's invites ─────────────────────────────
router.get("/team/invites", requireAuth, async (req: Request, res: Response) => {
  const hostUserId = req.userId!;
  const { rows } = await pool.query<{
    id: string;
    guest_email: string;
    guest_user_id: string | null;
    token: string;
    status: string;
    created_at: Date;
    expires_at: Date;
    accepted_at: Date | null;
    revoked_at: Date | null;
    transition_ends_at: Date | null;
    guest_name: string | null;
  }>(
    `SELECT
      ti.id,
      ti.guest_email,
      ti.guest_user_id,
      ti.token,
      ti.status,
      ti.created_at,
      ti.expires_at,
      ti.accepted_at,
      ti.revoked_at,
      ti.transition_ends_at,
      u.name AS guest_name
    FROM team_invites ti
    LEFT JOIN users u ON u.id = ti.guest_user_id
    WHERE ti.host_user_id = $1
    ORDER BY ti.created_at DESC`,
    [hostUserId],
  );

  res.json(rows.map((r) => ({
    id: r.id,
    guestEmail: r.guest_email,
    guestUserId: r.guest_user_id ?? null,
    guestName: r.guest_name ?? null,
    token: r.token,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    acceptedAt: r.accepted_at ?? null,
    revokedAt: r.revoked_at ?? null,
    transitionEndsAt: r.transition_ends_at ?? null,
  })));
});

// ── POST /api/team/invites — create invite ──────────────────────────────────
router.post("/team/invites", requireAuth, async (req: Request, res: Response) => {
  const hostUserId = req.userId!;

  const sub = await getSubscription(hostUserId);
  if (sub.plan !== "pro") {
    res.status(403).json({ error: "Team-Einladungen sind nur im Pro-Tarif verfügbar." });
    return;
  }

  const parsed = CreateInviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige E-Mail-Adresse." });
    return;
  }
  const { guestEmail } = parsed.data;

  const activeCount = await countActiveInvites(hostUserId);
  if (activeCount >= MAX_TEAM_SLOTS) {
    res.status(409).json({ error: `Maximale Team-Größe (${MAX_TEAM_SLOTS}) erreicht.` });
    return;
  }

  const expiresAt = addDays(new Date(), INVITE_VALID_DAYS);

  const { rows } = await pool.query<{ id: string; token: string }>(
    `INSERT INTO team_invites (host_user_id, guest_email, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, token`,
    [hostUserId, guestEmail.toLowerCase(), expiresAt.toISOString()],
  );

  const invite = rows[0];
  res.status(201).json({ id: invite.id, token: invite.token, guestEmail, expiresAt });
});

// ── DELETE /api/team/invites/:id — revoke invite ────────────────────────────
router.delete("/team/invites/:id", requireAuth, async (req: Request, res: Response) => {
  const hostUserId = req.userId!;
  const { id } = req.params;

  const { rows } = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM team_invites
     WHERE id = $1::uuid AND host_user_id = $2
     LIMIT 1`,
    [id, hostUserId],
  );

  if (!rows[0]) {
    res.status(404).json({ error: "Einladung nicht gefunden." });
    return;
  }

  if (rows[0].status === "revoked") {
    res.status(409).json({ error: "Einladung wurde bereits widerrufen." });
    return;
  }

  const now = new Date();
  const wasAccepted = rows[0].status === "accepted";
  // Grace period only applies to accepted invites — a revoked pending invite frees its slot immediately
  const transitionEndsAt = wasAccepted ? addDays(now, GRACE_DAYS) : null;

  await pool.query(
    `UPDATE team_invites
     SET status = 'revoked',
         revoked_at = $1,
         transition_ends_at = $2
     WHERE id = $3::uuid AND host_user_id = $4`,
    [now.toISOString(), transitionEndsAt ? transitionEndsAt.toISOString() : null, id, hostUserId],
  );

  res.json({ ok: true, transitionEndsAt: transitionEndsAt ?? null });
});

// ── GET /api/team/accept/:token — public, get invite info ──────────────────
router.get("/team/accept/:token", async (req: Request, res: Response) => {
  const { token } = req.params;

  const { rows } = await pool.query<{
    id: string;
    guest_email: string;
    status: string;
    expires_at: Date;
    host_name: string | null;
    host_email: string | null;
  }>(
    `SELECT
      ti.id,
      ti.guest_email,
      ti.status,
      ti.expires_at,
      u.name AS host_name,
      u.email AS host_email
    FROM team_invites ti
    JOIN users u ON u.id = ti.host_user_id
    WHERE ti.token = $1::uuid
    LIMIT 1`,
    [token],
  );

  const row = rows[0];

  if (!row) {
    res.status(404).json({ error: "Einladung nicht gefunden." });
    return;
  }

  if (row.status === "revoked") {
    res.status(410).json({ error: "Diese Einladung wurde widerrufen." });
    return;
  }

  if (row.status === "accepted") {
    res.json({ alreadyAccepted: true, guestEmail: row.guest_email, hostName: row.host_name ?? row.host_email });
    return;
  }

  if (new Date(row.expires_at) < new Date()) {
    res.status(410).json({ error: "Diese Einladung ist abgelaufen." });
    return;
  }

  res.json({
    id: row.id,
    guestEmail: row.guest_email,
    status: row.status,
    expiresAt: row.expires_at,
    hostName: row.host_name ?? row.host_email ?? "Unbekannter Betrieb",
    hostEmail: row.host_email,
  });
});

// ── POST /api/team/accept/:token — accept invite (authenticated) ────────────
router.post("/team/accept/:token", requireAuth, async (req: Request, res: Response) => {
  const guestUserId = req.userId!;
  const guestEmail = req.appUser?.email ?? null;
  const { token } = req.params;

  const { rows } = await pool.query<{
    id: string;
    host_user_id: string;
    guest_email: string;
    status: string;
    expires_at: Date;
  }>(
    `SELECT id, host_user_id, guest_email, status, expires_at
     FROM team_invites
     WHERE token = $1::uuid
     LIMIT 1`,
    [token],
  );

  const row = rows[0];

  if (!row) {
    res.status(404).json({ error: "Einladung nicht gefunden." });
    return;
  }

  if (row.status === "revoked") {
    res.status(410).json({ error: "Diese Einladung wurde widerrufen." });
    return;
  }

  if (row.status === "accepted") {
    res.json({ ok: true, alreadyAccepted: true });
    return;
  }

  if (new Date(row.expires_at) < new Date()) {
    res.status(410).json({ error: "Diese Einladung ist abgelaufen." });
    return;
  }

  if (row.host_user_id === guestUserId) {
    res.status(400).json({ error: "Du kannst dich nicht selbst einladen." });
    return;
  }

  if (guestEmail && guestEmail.toLowerCase() !== row.guest_email.toLowerCase()) {
    res.status(403).json({ error: "Diese Einladung gilt für eine andere E-Mail-Adresse." });
    return;
  }

  await pool.query(
    `UPDATE team_invites
     SET status = 'accepted',
         guest_user_id = $1,
         accepted_at = NOW()
     WHERE id = $2::uuid`,
    [guestUserId, row.id],
  );

  res.json({ ok: true });
});

// ── GET /api/team/my-hosts — hosts the user is guest for ───────────────────
router.get("/team/my-hosts", requireAuth, async (req: Request, res: Response) => {
  const guestUserId = req.userId!;

  const { rows } = await pool.query<{
    host_user_id: string;
    host_name: string | null;
    host_email: string | null;
    accepted_at: Date | null;
    transition_ends_at: Date | null;
  }>(
    `SELECT DISTINCT ON (ti.host_user_id)
      ti.host_user_id,
      u.name AS host_name,
      u.email AS host_email,
      ti.accepted_at,
      ti.transition_ends_at
    FROM team_invites ti
    JOIN users u ON u.id = ti.host_user_id
    WHERE ti.guest_user_id = $1
      AND (
        (ti.status = 'accepted' AND ti.revoked_at IS NULL)
        OR (ti.status = 'revoked' AND ti.transition_ends_at IS NOT NULL AND ti.transition_ends_at > NOW())
      )
    ORDER BY ti.host_user_id, ti.accepted_at DESC`,
    [guestUserId],
  );

  res.json(rows.map((r) => ({
    hostUserId: r.host_user_id,
    hostName: r.host_name ?? r.host_email ?? "Unbekannter Betrieb",
    hostEmail: r.host_email ?? null,
    acceptedAt: r.accepted_at ?? null,
    transitionEndsAt: r.transition_ends_at ?? null,
  })));
});

export default router;

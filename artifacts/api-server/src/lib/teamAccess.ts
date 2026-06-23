import { pool } from "@workspace/db";

/**
 * Returns the owner userId if the guestUserId is currently an active guest
 * for the dataset owner, or null if no active guest access exists.
 */
export async function resolveGuestAccess(
  datasetId: string,
  guestUserId: string,
): Promise<{ ownerUserId: string } | null> {
  const { rows } = await pool.query<{ owner_user_id: string }>(
    `SELECT d.user_id AS owner_user_id
     FROM datasets d
     JOIN team_invites ti ON ti.host_user_id = d.user_id
     WHERE d.id = $1
       AND ti.guest_user_id = $2
       AND ti.status = 'accepted'
       AND (
         ti.revoked_at IS NULL
         OR (ti.transition_ends_at IS NOT NULL AND ti.transition_ends_at > NOW())
       )
     LIMIT 1`,
    [datasetId, guestUserId],
  );
  if (!rows[0]) return null;
  return { ownerUserId: rows[0].owner_user_id };
}

/**
 * Returns true if the user owns the dataset OR is an active guest for its owner.
 */
export async function canReadDataset(
  datasetId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM datasets WHERE id = $1 LIMIT 1`,
    [datasetId],
  );
  if (rows[0]?.user_id === userId) return true;

  const guest = await resolveGuestAccess(datasetId, userId);
  return guest !== null;
}

/**
 * Returns all host userIds for which userId has an active accepted invite.
 */
export async function getActiveHostIds(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ host_user_id: string }>(
    `SELECT DISTINCT host_user_id
     FROM team_invites
     WHERE guest_user_id = $1
       AND status = 'accepted'
       AND (
         revoked_at IS NULL
         OR (transition_ends_at IS NOT NULL AND transition_ends_at > NOW())
       )`,
    [userId],
  );
  return rows.map((r) => r.host_user_id);
}

/**
 * Counts how many active (pending or accepted, non-revoked) invites the host has.
 */
export async function countActiveInvites(hostUserId: string): Promise<number> {
  const { rows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM team_invites
     WHERE host_user_id = $1
       AND status IN ('pending', 'accepted')`,
    [hostUserId],
  );
  return parseInt(rows[0]?.cnt ?? "0", 10);
}

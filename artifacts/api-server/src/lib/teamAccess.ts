import { pool } from "@workspace/db";

/**
 * Returns the owner userId if the guestUserId currently has active access
 * (accepted + not revoked, OR revoked but still within the 30-day grace).
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
       AND (
         (ti.status = 'accepted' AND ti.revoked_at IS NULL)
         OR (ti.status = 'revoked' AND ti.transition_ends_at IS NOT NULL AND ti.transition_ends_at > NOW())
       )
     LIMIT 1`,
    [datasetId, guestUserId],
  );
  if (!rows[0]) return null;
  return { ownerUserId: rows[0].owner_user_id };
}

/**
 * Returns true if the user owns the dataset OR has active guest access.
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
 * Returns all host userIds for which userId has active access
 * (accepted + not revoked, OR revoked but still within grace period).
 */
export async function getActiveHostIds(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ host_user_id: string }>(
    `SELECT DISTINCT host_user_id
     FROM team_invites
     WHERE guest_user_id = $1
       AND (
         (status = 'accepted' AND revoked_at IS NULL)
         OR (status = 'revoked' AND transition_ends_at IS NOT NULL AND transition_ends_at > NOW())
       )`,
    [userId],
  );
  return rows.map((r) => r.host_user_id);
}

/**
 * Counts truly active invite slots for a host:
 * - pending and not yet expired
 * - accepted and not revoked
 * - revoked but still in grace period (still occupies a slot until fully expired)
 * Excludes expired-pending and fully-expired revocations.
 */
export async function countActiveInvites(hostUserId: string): Promise<number> {
  const { rows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM team_invites
     WHERE host_user_id = $1
       AND (
         (status = 'pending' AND expires_at > NOW())
         OR (status = 'accepted' AND revoked_at IS NULL)
         OR (status = 'revoked' AND transition_ends_at IS NOT NULL AND transition_ends_at > NOW())
       )`,
    [hostUserId],
  );
  return parseInt(rows[0]?.cnt ?? "0", 10);
}

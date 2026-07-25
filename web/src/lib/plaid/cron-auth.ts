import { timingSafeEqual } from "node:crypto";

/** True when Authorization matches Bearer ${CRON_SECRET}. */
export function authorizeCronRequest(req: Request): {
  ok: boolean;
  reason?: string;
} {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { ok: false, reason: "CRON_SECRET is not configured" };
  }

  const header = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "Authorization header mismatch" };
  }
  return { ok: true };
}

/** Stale when never synced, or last sync is older than `staleAfterMs`. */
export function isPlaidSyncStale(
  lastSyncedAt: string | null | undefined,
  staleAfterMs: number,
  nowMs = Date.now(),
): boolean {
  if (!lastSyncedAt) return true;
  const synced = Date.parse(lastSyncedAt);
  if (!Number.isFinite(synced)) return true;
  return nowMs - synced >= staleAfterMs;
}

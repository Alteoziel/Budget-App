/** Absolute time between primary sign-ins before reauthentication is required. */
export const REAUTH_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * `last_sign_in_at` comes from Supabase Auth's server-verified user record.
 * Silent access-token refreshes do not update it.
 */
export function hasRecentPrimarySignIn(
  lastSignInAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!lastSignInAt) return false;
  const signedInAt = Date.parse(lastSignInAt);
  if (!Number.isFinite(signedInAt) || signedInAt > nowMs) return false;
  return nowMs - signedInAt < REAUTH_INTERVAL_MS;
}

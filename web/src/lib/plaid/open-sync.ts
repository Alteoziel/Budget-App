/**
 * Client-safe open-app bank sync helpers (no server-only imports).
 */

/**
 * Open-app / resume auto-sync cooldown. Skip automatic bank syncs when a
 * sync already started within the last hour (manual Sync now is unaffected).
 */
export const PLAID_OPEN_SYNC_DEBOUNCE_MS = 60 * 60 * 1000;

/** Compact status line for the open-app bank sync toast. */
export function formatOpenSyncNotice(input: {
  skipped?: boolean;
  reason?: string;
  inserted?: number;
  updated?: number;
  errors?: string[];
}): string {
  if (input.skipped) {
    if (input.reason === "No bank connections") return "No bank linked yet";
    if (input.reason === "Recent sync already in progress or finished") {
      return "Bank already synced";
    }
    return "Bank sync skipped";
  }
  if (input.errors?.length) {
    return input.errors[0] || "Bank sync finished with errors";
  }
  const inserted = input.inserted ?? 0;
  const updated = input.updated ?? 0;
  if (inserted > 0) {
    return `Imported ${inserted} new transaction${inserted === 1 ? "" : "s"}`;
  }
  if (updated > 0) {
    return `Updated ${updated} transaction${updated === 1 ? "" : "s"}`;
  }
  return "Bank is up to date";
}

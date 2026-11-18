/**
 * Detect duplicate Plaid imports after reconnecting the same bank.
 * Plaid issues new transaction_ids per Item, so external_id uniqueness
 * does not prevent the same real-world rows from being stored twice.
 */

export type PlaidDedupeRow = {
  id: string;
  occurred_on: string;
  payee: string;
  amount_cents: number;
  external_id: string | null;
  created_at: string;
  cleared?: boolean | null;
};

export function plaidTxnFingerprint(row: {
  occurred_on: string;
  payee: string;
  amount_cents: number;
}): string {
  return `${row.occurred_on}|${row.amount_cents}|${row.payee.trim()}`;
}

/**
 * For each fingerprint, keep as many rows as the busiest single created_at day
 * (the legitimate count), preferring the newest rows. Extra copies from an
 * earlier reconnect wave are returned for deletion.
 */
export function findRelinkDuplicateIds(rows: PlaidDedupeRow[]): string[] {
  const plaidRows = rows.filter((row) =>
    (row.external_id ?? "").startsWith("plaid:"),
  );
  const groups = new Map<string, PlaidDedupeRow[]>();
  for (const row of plaidRows) {
    const key = plaidTxnFingerprint(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const remove: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const byDay = new Map<string, number>();
    for (const row of group) {
      const day = row.created_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    // Only treat as reconnect duplication when copies span multiple import days.
    if (byDay.size < 2) continue;

    const keepCount = Math.max(...byDay.values());
    const ordered = [...group].sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
    );
    for (const row of ordered.slice(keepCount)) {
      remove.push(row.id);
    }
  }
  return remove;
}

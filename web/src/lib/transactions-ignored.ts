/** True when a transaction row is marked ignored. */
export function isIgnoredTxn(row: { ignored?: boolean | null }): boolean {
  return row.ignored === true;
}

/** Drop ignored rows; treats missing `ignored` as active. */
export function filterActiveTxns<T extends { ignored?: boolean | null }>(
  rows: T[] | null | undefined,
): T[] {
  return (rows ?? []).filter((row) => !isIgnoredTxn(row));
}

/** Detect PostgREST/schema errors when the ignored column is not migrated yet. */
export function isIgnoredColumnMissing(message: string | undefined | null): boolean {
  if (!message) return false;
  return /ignored|schema cache|column/i.test(message);
}

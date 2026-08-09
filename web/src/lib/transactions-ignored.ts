/** True when a transaction is marked ignored from insights. */
export function isIgnoredTxn(row: { ignored?: boolean | null }): boolean {
  return row.ignored === true;
}

/** Drop insights-ignored rows; treats missing `ignored` as active. */
export function filterInsightsTxns<T extends { ignored?: boolean | null }>(
  rows: T[] | null | undefined,
): T[] {
  return (rows ?? []).filter((row) => !isIgnoredTxn(row));
}

/** Detect PostgREST/schema errors when the ignored column is not migrated yet. */
export function isIgnoredColumnMissing(message: string | undefined | null): boolean {
  if (!message) return false;
  return /ignored|schema cache|column/i.test(message);
}

import type { SupabaseClient } from "@supabase/supabase-js";

export const BALANCE_ANCHOR_PREFIX = "balance-anchor:";

export function balanceAnchorExternalId(accountId: string): string {
  return `${BALANCE_ANCHOR_PREFIX}${accountId}`;
}

export function isBalanceAnchorExternalId(externalId: string | null | undefined): boolean {
  return Boolean(externalId?.startsWith(BALANCE_ANCHOR_PREFIX));
}

export function isBankExternalId(externalId: string | null | undefined): boolean {
  return Boolean(
    externalId?.startsWith("plaid:") || externalId?.startsWith("teller:"),
  );
}

/** Exact cents preferred; allow up to $1 drift for "almost identical". */
export const MATCH_AMOUNT_TOLERANCE_CENTS = 100;
/** Calendar-day window around the bank transaction date. */
export const MATCH_DATE_WINDOW_DAYS = 5;

type TxnRow = {
  id: string;
  account_id: string;
  amount_cents: number;
  occurred_on: string;
  payee: string | null;
  external_id: string | null;
};

function parseIsoDate(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(parseIsoDate(a) - parseIsoDate(b)) / 86_400_000;
}

function amountCompatible(a: number, b: number): boolean {
  if (Math.sign(a) !== Math.sign(b)) return false;
  return Math.abs(a - b) <= MATCH_AMOUNT_TOLERANCE_CENTS;
}

function scoreMatch(bank: TxnRow, manual: TxnRow): number {
  const amountDiff = Math.abs(bank.amount_cents - manual.amount_cents);
  const dateDiff = daysBetween(bank.occurred_on, manual.occurred_on);
  // Prefer exact amount, then closer dates.
  return amountDiff * 1000 + dateDiff;
}

async function blockedPairs(
  supabase: SupabaseClient,
  budgetId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("transaction_match_suggestions")
    .select("manual_transaction_id,bank_transaction_id,status")
    .eq("budget_id", budgetId)
    .in("status", ["pending", "approved", "denied"]);

  const blocked = new Set<string>();
  for (const row of data ?? []) {
    blocked.add(`${row.manual_transaction_id}:${row.bank_transaction_id}`);
  }
  return blocked;
}

async function pendingOccupied(
  supabase: SupabaseClient,
  budgetId: string,
): Promise<{ manuals: Set<string>; banks: Set<string> }> {
  const { data } = await supabase
    .from("transaction_match_suggestions")
    .select("manual_transaction_id,bank_transaction_id")
    .eq("budget_id", budgetId)
    .eq("status", "pending");

  const manuals = new Set<string>();
  const banks = new Set<string>();
  for (const row of data ?? []) {
    manuals.add(row.manual_transaction_id as string);
    banks.add(row.bank_transaction_id as string);
  }
  return { manuals, banks };
}

async function insertSuggestion(
  supabase: SupabaseClient,
  args: {
    budgetId: string;
    accountId: string;
    manualId: string;
    bankId: string;
    amountDiffCents: number;
  },
): Promise<boolean> {
  const { error } = await supabase.from("transaction_match_suggestions").insert({
    budget_id: args.budgetId,
    account_id: args.accountId,
    manual_transaction_id: args.manualId,
    bank_transaction_id: args.bankId,
    status: "pending",
    amount_diff_cents: args.amountDiffCents,
  });
  if (error) {
    // Unique / race — ignore.
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
      return false;
    }
    throw error;
  }
  return true;
}

/** After a bank txn is inserted, look for a near-identical manual entry. */
export async function suggestMatchForBankTransaction(
  supabase: SupabaseClient,
  args: {
    budgetId: string;
    accountId: string;
    bankTransactionId: string;
    amountCents: number;
    occurredOn: string;
  },
): Promise<boolean> {
  const occupied = await pendingOccupied(supabase, args.budgetId);
  if (occupied.banks.has(args.bankTransactionId)) return false;

  const blocked = await blockedPairs(supabase, args.budgetId);

  const { data: manuals, error } = await supabase
    .from("transactions")
    .select("id,account_id,amount_cents,occurred_on,payee,external_id")
    .eq("budget_id", args.budgetId)
    .eq("account_id", args.accountId)
    .is("external_id", null)
    .limit(200);
  if (error) throw error;

  const bank: TxnRow = {
    id: args.bankTransactionId,
    account_id: args.accountId,
    amount_cents: args.amountCents,
    occurred_on: args.occurredOn,
    payee: null,
    external_id: "plaid:",
  };

  const candidates = ((manuals as TxnRow[] | null) ?? [])
    .filter((manual) => !occupied.manuals.has(manual.id))
    .filter((manual) => !blocked.has(`${manual.id}:${bank.id}`))
    .filter((manual) => amountCompatible(manual.amount_cents, bank.amount_cents))
    .filter(
      (manual) =>
        daysBetween(manual.occurred_on, bank.occurred_on) <= MATCH_DATE_WINDOW_DAYS,
    )
    .sort((a, b) => scoreMatch(bank, a) - scoreMatch(bank, b));

  const best = candidates[0];
  if (!best) return false;

  return insertSuggestion(supabase, {
    budgetId: args.budgetId,
    accountId: args.accountId,
    manualId: best.id,
    bankId: bank.id,
    amountDiffCents: Math.abs(best.amount_cents - bank.amount_cents),
  });
}

/** After a manual txn is created, look for a near-identical bank entry. */
export async function suggestMatchForManualTransaction(
  supabase: SupabaseClient,
  args: {
    budgetId: string;
    accountId: string;
    manualTransactionId: string;
    amountCents: number;
    occurredOn: string;
  },
): Promise<boolean> {
  const occupied = await pendingOccupied(supabase, args.budgetId);
  if (occupied.manuals.has(args.manualTransactionId)) return false;

  const blocked = await blockedPairs(supabase, args.budgetId);

  const { data: banks, error } = await supabase
    .from("transactions")
    .select("id,account_id,amount_cents,occurred_on,payee,external_id")
    .eq("budget_id", args.budgetId)
    .eq("account_id", args.accountId)
    .not("external_id", "is", null)
    .limit(300);
  if (error) throw error;

  const manual: TxnRow = {
    id: args.manualTransactionId,
    account_id: args.accountId,
    amount_cents: args.amountCents,
    occurred_on: args.occurredOn,
    payee: null,
    external_id: null,
  };

  const candidates = ((banks as TxnRow[] | null) ?? [])
    .filter((bank) => isBankExternalId(bank.external_id))
    .filter((bank) => !isBalanceAnchorExternalId(bank.external_id))
    .filter((bank) => !occupied.banks.has(bank.id))
    .filter((bank) => !blocked.has(`${manual.id}:${bank.id}`))
    .filter((bank) => amountCompatible(manual.amount_cents, bank.amount_cents))
    .filter(
      (bank) =>
        daysBetween(manual.occurred_on, bank.occurred_on) <= MATCH_DATE_WINDOW_DAYS,
    )
    .sort((a, b) => scoreMatch(a, manual) - scoreMatch(b, manual));

  const best = candidates[0];
  if (!best) return false;

  return insertSuggestion(supabase, {
    budgetId: args.budgetId,
    accountId: args.accountId,
    manualId: manual.id,
    bankId: best.id,
    amountDiffCents: Math.abs(manual.amount_cents - best.amount_cents),
  });
}

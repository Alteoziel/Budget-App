import { cache } from "react";
import { requireBudget } from "@/lib/budget-context";

export const MAX_MONTHS_BACK = 24;

/**
 * Compact, pre-aggregated snapshot of everything the Insights page needs.
 * Fetched once per page load so filter changes can be applied in the browser
 * instead of round-tripping to the database.
 */
export type InsightsDataset = {
  months: string[];
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; groupName: string }>;
  /** [monthIndex, accountIndex, categoryIndex (-1 = uncategorized), amountCents] */
  cells: Array<[number, number, number, number]>;
  /** Balance carried into the first month, per account index. */
  priorByAccount: number[];
  /** Recurring-charge detection input: [monthIndex, payeeIndex, outflowCents] */
  payeeCells: Array<[number, number, number]>;
  payees: string[];
  /**
   * Outflow transactions for category drill-down:
   * [monthIndex, accountIndex, categoryIndex (-1 = uncategorized), amountCents (negative), dayOfMonth, payeeIndex]
   */
  txnCells: Array<[number, number, number, number, number, number]>;
  /** Payee strings indexed by txnCells payeeIndex. */
  txnPayees: string[];
};

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  return monthKey(new Date(Date.UTC(y!, m! - 1 + delta, 1)));
}

const MAX_PAYEES = 200;

export const getInsightsDataset = cache(async (): Promise<InsightsDataset> => {
  const { supabase, budget } = await requireBudget("viewer");

  const now = new Date();
  const endMonth = monthKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)));
  const startMonth = addMonths(endMonth, -(MAX_MONTHS_BACK - 1));
  const startDate = `${startMonth}-01`;
  const endExclusive = `${addMonths(endMonth, 1)}-01`;

  const months: string[] = [];
  for (let i = 0; i < MAX_MONTHS_BACK; i += 1) months.push(addMonths(startMonth, i));

  const [txnsRes, accountsRes, categoriesRes, groupsRes, priorRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("account_id,category_id,amount_cents,occurred_on,payee")
      .eq("budget_id", budget.id)
      .gte("occurred_on", startDate)
      .lt("occurred_on", endExclusive),
    supabase.from("accounts").select("id,name").eq("budget_id", budget.id).order("name"),
    supabase
      .from("categories")
      .select("id,name,group_id")
      .eq("budget_id", budget.id)
      .order("name"),
    supabase.from("category_groups").select("id,name").eq("budget_id", budget.id),
    supabase
      .from("transactions")
      .select("account_id,amount_cents")
      .eq("budget_id", budget.id)
      .lt("occurred_on", startDate),
  ]);

  for (const res of [txnsRes, accountsRes, categoriesRes, groupsRes, priorRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const groupNames = new Map(
    (groupsRes.data ?? []).map((g) => [g.id as string, g.name as string]),
  );

  const accounts = (accountsRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
  }));
  const categories = (categoriesRes.data ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    groupName: groupNames.get(c.group_id as string) ?? "Ungrouped",
  }));

  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const accountIndex = new Map(accounts.map((a, i) => [a.id, i]));
  const categoryIndex = new Map(categories.map((c, i) => [c.id, i]));

  const cellTotals = new Map<string, number>();
  const payeeMonthTotals = new Map<string, number>();
  const payeeCounts = new Map<string, Set<number>>();
  const txnPayeeList: string[] = [];
  const txnPayeeIndex = new Map<string, number>();
  const txnCells: InsightsDataset["txnCells"] = [];

  for (const txn of txnsRes.data ?? []) {
    const occurredOn = String(txn.occurred_on);
    const mi = monthIndex.get(occurredOn.slice(0, 7));
    if (mi == null) continue;
    const ai = accountIndex.get(txn.account_id as string);
    if (ai == null) continue;
    const categoryId = txn.category_id as string | null;
    const ci = categoryId == null ? -1 : (categoryIndex.get(categoryId) ?? -1);
    const amount = txn.amount_cents as number;

    const key = `${mi}|${ai}|${ci}`;
    cellTotals.set(key, (cellTotals.get(key) ?? 0) + amount);

    if (amount < 0) {
      const day = Number(occurredOn.slice(8, 10)) || 1;
      const payeeRaw = String(txn.payee ?? "").trim();
      const payeeKey = payeeRaw.toLowerCase();
      let pi = txnPayeeIndex.get(payeeKey);
      if (pi == null) {
        pi = txnPayeeList.length;
        txnPayeeIndex.set(payeeKey, pi);
        txnPayeeList.push(payeeRaw || "Unknown");
      }
      txnCells.push([mi, ai, ci, amount, day, pi]);

      if (payeeKey) {
        const pKey = `${payeeKey}|${mi}`;
        payeeMonthTotals.set(pKey, (payeeMonthTotals.get(pKey) ?? 0) + Math.abs(amount));
        const seen = payeeCounts.get(payeeKey) ?? new Set<number>();
        seen.add(mi);
        payeeCounts.set(payeeKey, seen);
      }
    }
  }

  const cells: InsightsDataset["cells"] = [];
  for (const [key, amount] of cellTotals) {
    const [mi, ai, ci] = key.split("|").map(Number);
    cells.push([mi!, ai!, ci!, amount]);
  }

  // Only payees that could ever look recurring, capped to bound the payload.
  const recurringPayees = [...payeeCounts.entries()]
    .filter(([, monthsSeen]) => monthsSeen.size >= 3)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, MAX_PAYEES)
    .map(([payee]) => payee);
  const payeeIndex = new Map(recurringPayees.map((p, i) => [p, i]));

  const payeeCells: InsightsDataset["payeeCells"] = [];
  for (const [key, cents] of payeeMonthTotals) {
    const separator = key.lastIndexOf("|");
    const payee = key.slice(0, separator);
    const pi = payeeIndex.get(payee);
    if (pi == null) continue;
    payeeCells.push([Number(key.slice(separator + 1)), pi, cents]);
  }

  const priorByAccount = new Array<number>(accounts.length).fill(0);
  for (const row of priorRes.data ?? []) {
    const ai = accountIndex.get(row.account_id as string);
    if (ai == null) continue;
    priorByAccount[ai] += row.amount_cents as number;
  }

  return {
    months,
    accounts,
    categories,
    cells,
    priorByAccount,
    payeeCells,
    payees: recurringPayees,
    txnCells,
    txnPayees: txnPayeeList,
  };
});

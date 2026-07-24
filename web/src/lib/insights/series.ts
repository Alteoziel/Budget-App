import { requireBudget } from "@/lib/budget-context";

export type MonthPoint = {
  month: string; // YYYY-MM
  spendingCents: number;
  incomeCents: number;
  endBalanceCents: number;
};

export type InsightsFilters = {
  monthsBack?: number;
  accountIds?: string[];
  categoryIds?: string[];
};

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return monthKey(d);
}

function monthStart(ym: string): string {
  return `${ym}-01`;
}

function monthEndExclusive(ym: string): string {
  return `${addMonths(ym, 1)}-01`;
}

export async function getInsightSeries(filters: InsightsFilters = {}): Promise<{
  points: MonthPoint[];
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; groupName: string }>;
}> {
  const { supabase, budget } = await requireBudget("viewer");
  const monthsBack = Math.min(Math.max(filters.monthsBack ?? 12, 3), 36);

  const now = new Date();
  const endMonth = monthKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)));
  const startMonth = addMonths(endMonth, -(monthsBack - 1));
  const startDate = monthStart(startMonth);

  const accountFilter = filters.accountIds?.filter(Boolean) ?? [];
  const categoryFilter = filters.categoryIds?.filter(Boolean) ?? [];

  let txnQuery = supabase
    .from("transactions")
    .select("account_id,category_id,amount_cents,occurred_on")
    .eq("budget_id", budget.id)
    .gte("occurred_on", startDate)
    .lt("occurred_on", monthEndExclusive(endMonth));

  if (accountFilter.length) txnQuery = txnQuery.in("account_id", accountFilter);

  const [txnsRes, accountsRes, categoriesRes, groupsRes, priorRes] = await Promise.all([
    txnQuery,
    supabase
      .from("accounts")
      .select("id,name")
      .eq("budget_id", budget.id)
      .order("name"),
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

  if (txnsRes.error) throw new Error(txnsRes.error.message);
  if (accountsRes.error) throw new Error(accountsRes.error.message);
  if (categoriesRes.error) throw new Error(categoriesRes.error.message);
  if (groupsRes.error) throw new Error(groupsRes.error.message);
  if (priorRes.error) throw new Error(priorRes.error.message);

  const groupMap = new Map((groupsRes.data ?? []).map((g) => [g.id as string, g.name as string]));

  const months: string[] = [];
  for (let i = 0; i < monthsBack; i += 1) months.push(addMonths(startMonth, i));

  const spending = new Map<string, number>();
  const income = new Map<string, number>();
  const monthDelta = new Map<string, number>();
  for (const m of months) {
    spending.set(m, 0);
    income.set(m, 0);
    monthDelta.set(m, 0);
  }

  for (const txn of txnsRes.data ?? []) {
    const amount = txn.amount_cents as number;
    const occurred = String(txn.occurred_on);
    const ym = occurred.slice(0, 7);
    if (!spending.has(ym)) continue;

    // Balance includes all filtered accounts
    if (!accountFilter.length || accountFilter.includes(txn.account_id as string)) {
      monthDelta.set(ym, (monthDelta.get(ym) ?? 0) + amount);
    }

    const categoryId = txn.category_id as string | null;
    if (categoryFilter.length && (!categoryId || !categoryFilter.includes(categoryId))) {
      continue;
    }

    if (amount < 0) spending.set(ym, (spending.get(ym) ?? 0) + Math.abs(amount));
    if (amount > 0) income.set(ym, (income.get(ym) ?? 0) + amount);
  }

  let running = 0;
  for (const row of priorRes.data ?? []) {
    if (accountFilter.length && !accountFilter.includes(row.account_id as string)) continue;
    running += row.amount_cents as number;
  }

  const points: MonthPoint[] = months.map((month) => {
    running += monthDelta.get(month) ?? 0;
    return {
      month,
      spendingCents: spending.get(month) ?? 0,
      incomeCents: income.get(month) ?? 0,
      endBalanceCents: running,
    };
  });

  return {
    points,
    accounts: (accountsRes.data ?? []).map((a) => ({
      id: a.id as string,
      name: a.name as string,
    })),
    categories: (categoriesRes.data ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      groupName: groupMap.get(c.group_id as string) ?? "Ungrouped",
    })),
  };
}

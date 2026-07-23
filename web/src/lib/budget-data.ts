import { budgetMonthDateRange, currentBudgetMonth } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { Account, BudgetRow, Category, CategoryGroup, Transaction } from "@/lib/types";

export async function getBudgetRows(month = currentBudgetMonth()): Promise<{
  month: string;
  rows: BudgetRow[];
  readyToAssignCents: number;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { month, rows: [], readyToAssignCents: 0 };

  const range = budgetMonthDateRange(month);
  if (!range) return { month, rows: [], readyToAssignCents: 0 };

  const [{ data: groups }, { data: categories }, { data: assignments }, { data: txns }] =
    await Promise.all([
      supabase
        .from("category_groups")
        .select("id,name,sort_order,hidden")
        .eq("user_id", user.id)
        .order("sort_order")
        .order("name"),
      supabase
        .from("categories")
        .select("id,group_id,name,sort_order,hidden")
        .eq("user_id", user.id)
        .order("sort_order")
        .order("name"),
      supabase
        .from("category_months")
        .select("category_id,month,assigned_cents")
        .eq("user_id", user.id)
        .eq("month", month),
      supabase
        .from("transactions")
        .select("category_id,amount_cents,occurred_on")
        .eq("user_id", user.id)
        .gte("occurred_on", range.start)
        .lt("occurred_on", range.endExclusive),
    ]);

  const groupMap = new Map((groups as CategoryGroup[] | null)?.map((g) => [g.id, g]) ?? []);
  const assignedMap = new Map(
    (assignments ?? []).map((a) => [a.category_id as string, a.assigned_cents as number]),
  );

  const activityMap = new Map<string, number>();
  let inflowUncategorized = 0;
  for (const txn of txns ?? []) {
    const amount = txn.amount_cents as number;
    const categoryId = txn.category_id as string | null;
    if (!categoryId) {
      if (amount > 0) inflowUncategorized += amount;
      continue;
    }
    activityMap.set(categoryId, (activityMap.get(categoryId) ?? 0) + amount);
  }

  const rows: BudgetRow[] = ((categories as Category[] | null) ?? [])
    .filter((c) => !c.hidden)
    .map((category) => {
      const group = groupMap.get(category.group_id);
      const assignedCents = assignedMap.get(category.id) ?? 0;
      const activityCents = activityMap.get(category.id) ?? 0;
      return {
        categoryId: category.id,
        groupId: category.group_id,
        groupName: group?.name ?? "Ungrouped",
        categoryName: category.name,
        assignedCents,
        activityCents,
        availableCents: assignedCents + activityCents,
      };
    })
    .sort((a, b) =>
      a.groupName === b.groupName
        ? a.categoryName.localeCompare(b.categoryName)
        : a.groupName.localeCompare(b.groupName),
    );

  const totalAssigned = rows.reduce((sum, row) => sum + row.assignedCents, 0);
  const readyToAssignCents = inflowUncategorized - totalAssigned;

  return { month, rows, readyToAssignCents };
}

export async function getAccountsWithBalances(): Promise<
  Array<Account & { balanceCents: number }>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: accounts }, { data: txns }] = await Promise.all([
    supabase.from("accounts").select("id,name,account_type,currency").eq("user_id", user.id).order("name"),
    supabase.from("transactions").select("account_id,amount_cents").eq("user_id", user.id),
  ]);

  const balances = new Map<string, number>();
  for (const txn of txns ?? []) {
    const id = txn.account_id as string;
    balances.set(id, (balances.get(id) ?? 0) + (txn.amount_cents as number));
  }

  return ((accounts as Account[] | null) ?? []).map((account) => ({
    ...account,
    balanceCents: balances.get(account.id) ?? 0,
  }));
}

export async function getAccountRegister(accountId: string): Promise<{
  account: Account | null;
  transactions: Transaction[];
  balanceCents: number;
  categories: Array<{ id: string; name: string; groupName: string }>;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { account: null, transactions: [], balanceCents: 0, categories: [] };
  }

  const [
    { data: account },
    { data: transactions },
    { data: balanceRows },
    { data: categories },
    { data: groups },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id,name,account_type,currency")
      .eq("user_id", user.id)
      .eq("id", accountId)
      .maybeSingle(),
    supabase
      .from("transactions")
      .select("id,account_id,category_id,occurred_on,payee,memo,amount_cents,cleared")
      .eq("user_id", user.id)
      .eq("account_id", accountId)
      .order("occurred_on", { ascending: false })
      .limit(200),
    supabase
      .from("transactions")
      .select("amount_cents")
      .eq("user_id", user.id)
      .eq("account_id", accountId),
    supabase
      .from("categories")
      .select("id,name,group_id")
      .eq("user_id", user.id)
      .order("name"),
    supabase.from("category_groups").select("id,name").eq("user_id", user.id),
  ]);

  const groupMap = new Map((groups ?? []).map((g) => [g.id as string, g.name as string]));
  const balanceCents = (balanceRows ?? []).reduce(
    (sum, row) => sum + (row.amount_cents as number),
    0,
  );

  return {
    account: (account as Account | null) ?? null,
    transactions: (transactions as Transaction[] | null) ?? [],
    balanceCents,
    categories: (categories ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      groupName: groupMap.get(c.group_id as string) ?? "Ungrouped",
    })),
  };
}

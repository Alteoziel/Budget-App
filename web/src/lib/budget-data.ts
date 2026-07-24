import { requireBudget } from "@/lib/budget-context";
import { budgetMonthDateRange, currentBudgetMonth } from "@/lib/money";
import type { Account, BudgetRow, Category, CategoryGroup, Transaction } from "@/lib/types";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export async function getBudgetRows(month = currentBudgetMonth()): Promise<{
  month: string;
  rows: BudgetRow[];
  readyToAssignCents: number;
}> {
  const ctx = await requireBudget("viewer");
  const { supabase, budget } = ctx;

  const range = budgetMonthDateRange(month);
  if (!range) return { month, rows: [], readyToAssignCents: 0 };

  const [
    groupsRes,
    categoriesWithPercentRes,
    assignmentsRes,
    priorAssignmentsRes,
    txnsRes,
    priorTxnsRes,
  ] = await Promise.all([
    supabase
      .from("category_groups")
      .select("id,name,sort_order,hidden,budget_id")
      .eq("budget_id", budget.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("categories")
      .select("id,group_id,name,sort_order,hidden,budget_id,assign_percent")
      .eq("budget_id", budget.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("category_months")
      .select("category_id,month,assigned_cents")
      .eq("budget_id", budget.id)
      .eq("month", month),
    supabase
      .from("category_months")
      .select("category_id,assigned_cents")
      .eq("budget_id", budget.id)
      .lt("month", month),
    supabase
      .from("transactions")
      .select("category_id,amount_cents,occurred_on")
      .eq("budget_id", budget.id)
      .gte("occurred_on", range.start)
      .lt("occurred_on", range.endExclusive),
    supabase
      .from("transactions")
      .select("category_id,amount_cents")
      .eq("budget_id", budget.id)
      .lt("occurred_on", range.start),
  ]);

  let categoriesData = categoriesWithPercentRes.data as Array<
    Category & { assign_percent?: number }
  > | null;
  let categoriesError = categoriesWithPercentRes.error;
  if (categoriesError && /assign_percent/i.test(categoriesError.message)) {
    const fallback = await supabase
      .from("categories")
      .select("id,group_id,name,sort_order,hidden,budget_id")
      .eq("budget_id", budget.id)
      .order("sort_order")
      .order("name");
    categoriesData = fallback.data as Array<Category & { assign_percent?: number }> | null;
    categoriesError = fallback.error;
  }

  assertNoError(groupsRes.error, "Failed to load category groups");
  assertNoError(categoriesError, "Failed to load categories");
  assertNoError(assignmentsRes.error, "Failed to load assignments");
  assertNoError(priorAssignmentsRes.error, "Failed to load prior assignments");
  assertNoError(txnsRes.error, "Failed to load transactions");
  assertNoError(priorTxnsRes.error, "Failed to load prior transactions");

  const groups = groupsRes.data;
  const categories = categoriesData;
  const assignments = assignmentsRes.data;
  const priorAssignments = priorAssignmentsRes.data;
  const txns = txnsRes.data;
  const priorTxns = priorTxnsRes.data;

  const groupMap = new Map((groups as CategoryGroup[] | null)?.map((g) => [g.id, g]) ?? []);
  const assignedMap = new Map(
    (assignments ?? []).map((a) => [a.category_id as string, a.assigned_cents as number]),
  );

  const carryInMap = new Map<string, number>();
  for (const row of priorAssignments ?? []) {
    const categoryId = row.category_id as string;
    carryInMap.set(
      categoryId,
      (carryInMap.get(categoryId) ?? 0) + (row.assigned_cents as number),
    );
  }
  for (const txn of priorTxns ?? []) {
    const categoryId = txn.category_id as string | null;
    if (!categoryId) continue;
    carryInMap.set(
      categoryId,
      (carryInMap.get(categoryId) ?? 0) + (txn.amount_cents as number),
    );
  }

  const activityMap = new Map<string, number>();
  let uncategorizedCurrent = 0;
  for (const txn of txns ?? []) {
    const amount = txn.amount_cents as number;
    const categoryId = txn.category_id as string | null;
    if (!categoryId) {
      uncategorizedCurrent += amount;
      continue;
    }
    activityMap.set(categoryId, (activityMap.get(categoryId) ?? 0) + amount);
  }

  let uncategorizedPrior = 0;
  for (const txn of priorTxns ?? []) {
    if (txn.category_id == null) {
      uncategorizedPrior += txn.amount_cents as number;
    }
  }

  const priorAssignedTotal = (priorAssignments ?? []).reduce(
    (sum, row) => sum + (row.assigned_cents as number),
    0,
  );
  const totalAssigned = (assignments ?? []).reduce(
    (sum, row) => sum + (row.assigned_cents as number),
    0,
  );

  const rows: BudgetRow[] = ((categories as Category[] | null) ?? [])
    .filter((c) => !c.hidden)
    .map((category) => {
      const group = groupMap.get(category.group_id);
      const assignedCents = assignedMap.get(category.id) ?? 0;
      const activityCents = activityMap.get(category.id) ?? 0;
      const carryInCents = carryInMap.get(category.id) ?? 0;
      return {
        categoryId: category.id,
        groupId: category.group_id,
        groupName: group?.name ?? "Ungrouped",
        categoryName: category.name,
        assignedCents,
        activityCents,
        availableCents: carryInCents + assignedCents + activityCents,
        assignPercent: Number(category.assign_percent ?? 0),
      };
    })
    .sort((a, b) =>
      a.groupName === b.groupName
        ? a.categoryName.localeCompare(b.categoryName)
        : a.groupName.localeCompare(b.groupName),
    );

  const readyToAssignCents =
    uncategorizedPrior - priorAssignedTotal + uncategorizedCurrent - totalAssigned;

  return { month, rows, readyToAssignCents };
}

export async function getAccountsWithBalances(): Promise<
  Array<Account & { balanceCents: number }>
> {
  const { supabase, budget } = await requireBudget("viewer");

  const [accountsRes, txnsRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id,budget_id,name,account_type,currency")
      .eq("budget_id", budget.id)
      .order("name"),
    supabase
      .from("transactions")
      .select("account_id,amount_cents")
      .eq("budget_id", budget.id),
  ]);

  assertNoError(accountsRes.error, "Failed to load accounts");
  assertNoError(txnsRes.error, "Failed to load account balances");

  const accounts = accountsRes.data;
  const txns = txnsRes.data;

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
  const { supabase, budget } = await requireBudget("viewer");

  const [accountRes, transactionsRes, balanceRes, categoriesRes, groupsRes] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id,budget_id,name,account_type,currency")
        .eq("budget_id", budget.id)
        .eq("id", accountId)
        .maybeSingle(),
      supabase
        .from("transactions")
        .select(
          "id,budget_id,account_id,category_id,occurred_on,payee,memo,amount_cents,cleared,external_id",
        )
        .eq("budget_id", budget.id)
        .eq("account_id", accountId)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("transactions")
        .select("amount_cents")
        .eq("budget_id", budget.id)
        .eq("account_id", accountId),
      supabase
        .from("categories")
        .select("id,name,group_id")
        .eq("budget_id", budget.id)
        .order("name"),
      supabase
        .from("category_groups")
        .select("id,name")
        .eq("budget_id", budget.id),
    ]);

  assertNoError(accountRes.error, "Failed to load account");
  assertNoError(transactionsRes.error, "Failed to load register");
  assertNoError(balanceRes.error, "Failed to load balance");
  assertNoError(categoriesRes.error, "Failed to load categories");
  assertNoError(groupsRes.error, "Failed to load category groups");

  const account = accountRes.data;
  const transactions = transactionsRes.data;
  const balanceRows = balanceRes.data;
  const categories = categoriesRes.data;
  const groups = groupsRes.data;

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

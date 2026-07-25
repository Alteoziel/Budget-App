import { cache } from "react";
import { readExcludedAccountIds } from "@/lib/account-total-filter";
import { requireBudget } from "@/lib/budget-context";
import {
  budgetMonthDateRange,
  budgetMonthFromDate,
  currentBudgetMonth,
  formatBudgetDate,
  formatBudgetMonth,
  isBudgetMonth,
  isValidIsoDate,
} from "@/lib/money";
import type {
  Account,
  AssignMode,
  BudgetRow,
  BudgetSnapshot,
  BudgetSnapshotTxn,
  Category,
  CategoryGroup,
  GoalFrequency,
  Transaction,
} from "@/lib/types";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

const CATEGORY_COLUMNS =
  "id,group_id,name,sort_order,hidden,budget_id,assign_percent,assign_mode,assign_fixed_cents,goal_cents,goal_name,goal_frequency,goal_note";

type CategoryRecord = Category & {
  assign_percent?: number;
  assign_mode?: string | null;
  assign_fixed_cents?: number | null;
  goal_cents?: number | null;
  goal_name?: string | null;
  goal_frequency?: string | null;
  goal_note?: string | null;
};

function toAssignMode(value: unknown): AssignMode {
  return value === "fixed" ? "fixed" : "percent";
}

const GOAL_FREQUENCIES = new Set([
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "once",
]);

function toGoalFrequency(value: unknown): GoalFrequency {
  return GOAL_FREQUENCIES.has(String(value))
    ? (String(value) as GoalFrequency)
    : "monthly";
}

export const getBudgetRows = cache(async (month = currentBudgetMonth()): Promise<{
  month: string;
  rows: BudgetRow[];
  readyToAssignCents: number;
  groups: Array<{ id: string; name: string }>;
}> => {
  const ctx = await requireBudget("viewer");
  const { supabase, budget } = ctx;

  const range = budgetMonthDateRange(month);
  if (!range) return { month, rows: [], readyToAssignCents: 0, groups: [] };

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
      .select(CATEGORY_COLUMNS)
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

  let categoriesData = categoriesWithPercentRes.data as CategoryRecord[] | null;
  let categoriesError = categoriesWithPercentRes.error;
  // Older databases may be missing assign / goal columns.
  if (
    categoriesError &&
    /assign_percent|assign_mode|assign_fixed|goal_|column|schema cache/i.test(
      categoriesError.message,
    )
  ) {
    const withPercent = await supabase
      .from("categories")
      .select("id,group_id,name,sort_order,hidden,budget_id,assign_percent")
      .eq("budget_id", budget.id)
      .order("sort_order")
      .order("name");
    if (withPercent.error) {
      const bare = await supabase
        .from("categories")
        .select("id,group_id,name,sort_order,hidden,budget_id")
        .eq("budget_id", budget.id)
        .order("sort_order")
        .order("name");
      categoriesData = bare.data as CategoryRecord[] | null;
      categoriesError = bare.error;
    } else {
      categoriesData = withPercent.data as CategoryRecord[] | null;
      categoriesError = withPercent.error;
    }
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

  const rows: BudgetRow[] = ((categories as CategoryRecord[] | null) ?? [])
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
        groupSortOrder: Number(group?.sort_order ?? 0),
        categoryName: category.name,
        categorySortOrder: Number(category.sort_order ?? 0),
        assignedCents,
        activityCents,
        availableCents: carryInCents + assignedCents + activityCents,
        assignPercent: Number(category.assign_percent ?? 0),
        assignMode: toAssignMode(category.assign_mode),
        assignFixedCents: Number(category.assign_fixed_cents ?? 0),
        goalCents:
          category.goal_cents == null ? null : Number(category.goal_cents),
        goalName: category.goal_name ?? "",
        goalFrequency: toGoalFrequency(category.goal_frequency),
        goalNote: category.goal_note ?? "",
      };
    })
    .sort((a, b) => {
      if (a.groupSortOrder !== b.groupSortOrder) {
        return a.groupSortOrder - b.groupSortOrder;
      }
      const byGroupName = a.groupName.localeCompare(b.groupName);
      if (byGroupName !== 0) return byGroupName;
      if (a.categorySortOrder !== b.categorySortOrder) {
        return a.categorySortOrder - b.categorySortOrder;
      }
      return a.categoryName.localeCompare(b.categoryName);
    });

  const readyToAssignCents =
    uncategorizedPrior - priorAssignedTotal + uncategorizedCurrent - totalAssigned;

  return {
    month,
    rows,
    readyToAssignCents,
    groups: ((groups as CategoryGroup[] | null) ?? [])
      .filter((group) => !group.hidden)
      .slice()
      .sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name);
      })
      .map((group) => ({ id: group.id, name: group.name })),
  };
});

/**
 * Point-in-time snapshot for a budget month or calendar day.
 * Day views use that month’s assignments with activity through the selected day
 * (assignments are stored per month, not per day).
 */
export const getBudgetSnapshot = cache(async (as: string): Promise<BudgetSnapshot | null> => {
  const isDay = isValidIsoDate(as);
  const month = isDay ? budgetMonthFromDate(as) : as;
  if (!month || !isBudgetMonth(month)) return null;
  if (!isDay && as !== month) return null;

  const asOfDate = isDay ? as : null;
  const range = budgetMonthDateRange(month);
  if (!range) return null;

  const activityEndExclusive = isDay
    ? (() => {
        const [y, m, d] = as.split("-").map(Number);
        const next = new Date(Date.UTC(y, m - 1, d + 1));
        return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
      })()
    : range.endExclusive;

  const totalThrough = isDay ? as : null;

  const { supabase, budget } = await requireBudget("viewer");

  const [
    groupsRes,
    categoriesRes,
    assignmentsRes,
    priorAssignmentsRes,
    activityRes,
    priorTxnsRes,
    totalRes,
    periodTxnsRes,
    accountsRes,
  ] = await Promise.all([
    supabase
      .from("category_groups")
      .select("id,name,sort_order,hidden")
      .eq("budget_id", budget.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("categories")
      .select(CATEGORY_COLUMNS)
      .eq("budget_id", budget.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("category_months")
      .select("category_id,assigned_cents")
      .eq("budget_id", budget.id)
      .eq("month", month),
    supabase
      .from("category_months")
      .select("category_id,assigned_cents")
      .eq("budget_id", budget.id)
      .lt("month", month),
    supabase
      .from("transactions")
      .select("category_id,amount_cents")
      .eq("budget_id", budget.id)
      .gte("occurred_on", range.start)
      .lt("occurred_on", activityEndExclusive),
    supabase
      .from("transactions")
      .select("category_id,amount_cents")
      .eq("budget_id", budget.id)
      .lt("occurred_on", range.start),
    isDay
      ? supabase
          .from("transactions")
          .select("amount_cents")
          .eq("budget_id", budget.id)
          .lte("occurred_on", totalThrough as string)
      : supabase
          .from("transactions")
          .select("amount_cents")
          .eq("budget_id", budget.id)
          .lt("occurred_on", range.endExclusive),
    isDay
      ? supabase
          .from("transactions")
          .select("id,occurred_on,payee,memo,amount_cents,category_id,account_id")
          .eq("budget_id", budget.id)
          .eq("occurred_on", as)
          .order("occurred_on", { ascending: false })
          .limit(80)
      : supabase
          .from("transactions")
          .select("id,occurred_on,payee,memo,amount_cents,category_id,account_id")
          .eq("budget_id", budget.id)
          .gte("occurred_on", range.start)
          .lt("occurred_on", range.endExclusive)
          .order("occurred_on", { ascending: false })
          .limit(80),
    supabase.from("accounts").select("id,name").eq("budget_id", budget.id),
  ]);

  let categoriesData = categoriesRes.data as CategoryRecord[] | null;
  let categoriesError = categoriesRes.error;
  if (
    categoriesError &&
    /assign_percent|assign_mode|assign_fixed|goal_|column|schema cache/i.test(
      categoriesError.message,
    )
  ) {
    const bare = await supabase
      .from("categories")
      .select("id,group_id,name,sort_order,hidden,budget_id")
      .eq("budget_id", budget.id)
      .order("sort_order")
      .order("name");
    categoriesData = bare.data as CategoryRecord[] | null;
    categoriesError = bare.error;
  }

  assertNoError(groupsRes.error, "Failed to load category groups");
  assertNoError(categoriesError, "Failed to load categories");
  assertNoError(assignmentsRes.error, "Failed to load assignments");
  assertNoError(priorAssignmentsRes.error, "Failed to load prior assignments");
  assertNoError(activityRes.error, "Failed to load activity");
  assertNoError(priorTxnsRes.error, "Failed to load prior transactions");
  assertNoError(totalRes.error, "Failed to load money total");
  assertNoError(periodTxnsRes.error, "Failed to load transactions");
  assertNoError(accountsRes.error, "Failed to load accounts");

  const groupMap = new Map(
    ((groupsRes.data as CategoryGroup[] | null) ?? []).map((g) => [g.id, g]),
  );
  const assignedMap = new Map(
    (assignmentsRes.data ?? []).map((a) => [
      a.category_id as string,
      a.assigned_cents as number,
    ]),
  );

  const carryInMap = new Map<string, number>();
  for (const row of priorAssignmentsRes.data ?? []) {
    const categoryId = row.category_id as string;
    carryInMap.set(
      categoryId,
      (carryInMap.get(categoryId) ?? 0) + (row.assigned_cents as number),
    );
  }
  for (const txn of priorTxnsRes.data ?? []) {
    const categoryId = txn.category_id as string | null;
    if (!categoryId) continue;
    carryInMap.set(
      categoryId,
      (carryInMap.get(categoryId) ?? 0) + (txn.amount_cents as number),
    );
  }

  const activityMap = new Map<string, number>();
  let uncategorizedCurrent = 0;
  let incomeCents = 0;
  let spendingCents = 0;
  for (const txn of activityRes.data ?? []) {
    const amount = txn.amount_cents as number;
    if (amount >= 0) incomeCents += amount;
    else spendingCents += -amount;
    const categoryId = txn.category_id as string | null;
    if (!categoryId) {
      uncategorizedCurrent += amount;
      continue;
    }
    activityMap.set(categoryId, (activityMap.get(categoryId) ?? 0) + amount);
  }

  let uncategorizedPrior = 0;
  for (const txn of priorTxnsRes.data ?? []) {
    if (txn.category_id == null) {
      uncategorizedPrior += txn.amount_cents as number;
    }
  }

  const priorAssignedTotal = (priorAssignmentsRes.data ?? []).reduce(
    (sum, row) => sum + (row.assigned_cents as number),
    0,
  );
  const totalAssigned = (assignmentsRes.data ?? []).reduce(
    (sum, row) => sum + (row.assigned_cents as number),
    0,
  );

  const rows: BudgetRow[] = ((categoriesData as CategoryRecord[] | null) ?? [])
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
        groupSortOrder: Number(group?.sort_order ?? 0),
        categoryName: category.name,
        categorySortOrder: Number(category.sort_order ?? 0),
        assignedCents,
        activityCents,
        availableCents: carryInCents + assignedCents + activityCents,
        assignPercent: Number(category.assign_percent ?? 0),
        assignMode: toAssignMode(category.assign_mode),
        assignFixedCents: Number(category.assign_fixed_cents ?? 0),
        goalCents: category.goal_cents == null ? null : Number(category.goal_cents),
        goalName: category.goal_name ?? "",
        goalFrequency: toGoalFrequency(category.goal_frequency),
        goalNote: category.goal_note ?? "",
      };
    })
    .sort((a, b) => {
      if (a.groupSortOrder !== b.groupSortOrder) return a.groupSortOrder - b.groupSortOrder;
      const byGroupName = a.groupName.localeCompare(b.groupName);
      if (byGroupName !== 0) return byGroupName;
      if (a.categorySortOrder !== b.categorySortOrder) {
        return a.categorySortOrder - b.categorySortOrder;
      }
      return a.categoryName.localeCompare(b.categoryName);
    });

  const categoryNameById = new Map(rows.map((r) => [r.categoryId, r.categoryName]));
  const accountNameById = new Map(
    ((accountsRes.data as Array<{ id: string; name: string }> | null) ?? []).map((a) => [
      a.id,
      a.name,
    ]),
  );

  const transactions: BudgetSnapshotTxn[] = (periodTxnsRes.data ?? []).map((txn) => ({
    id: txn.id as string,
    occurredOn: txn.occurred_on as string,
    payee: (txn.payee as string) || "Transaction",
    memo: (txn.memo as string) || "",
    amountCents: txn.amount_cents as number,
    categoryName: txn.category_id
      ? (categoryNameById.get(txn.category_id as string) ?? "Category")
      : null,
    accountName: accountNameById.get(txn.account_id as string) ?? "Account",
  }));

  const totalMoneyCents = (totalRes.data ?? []).reduce(
    (sum, row) => sum + (row.amount_cents as number),
    0,
  );
  const activityCents = (activityRes.data ?? []).reduce(
    (sum, row) => sum + (row.amount_cents as number),
    0,
  );
  const readyToAssignCents =
    uncategorizedPrior - priorAssignedTotal + uncategorizedCurrent - totalAssigned;

  return {
    kind: isDay ? "day" : "month",
    month,
    date: asOfDate,
    label: isDay ? formatBudgetDate(as) : formatBudgetMonth(month),
    readyToAssignCents,
    totalMoneyCents,
    activityCents,
    incomeCents,
    spendingCents,
    rows,
    transactions,
  };
});

export const getAccountsWithBalances = cache(async (): Promise<
  Array<Account & { balanceCents: number; include_in_total: boolean }>
> => {
  const { supabase, budget } = await requireBudget("viewer");

  let accountsRes: {
    data: Array<Record<string, unknown>> | null;
    error: { message: string } | null;
  } = await supabase
    .from("accounts")
    .select("id,budget_id,name,account_type,currency,include_in_total,sort_order")
    .eq("budget_id", budget.id)
    .order("sort_order")
    .order("name");

  let usedIncludeColumn = true;
  let usedSortColumn = true;
  // Columns may be missing until migrations are applied.
  if (
    accountsRes.error &&
    /sort_order|schema cache|column/i.test(accountsRes.error.message)
  ) {
    usedSortColumn = false;
    accountsRes = await supabase
      .from("accounts")
      .select("id,budget_id,name,account_type,currency,include_in_total")
      .eq("budget_id", budget.id)
      .order("name");
  }
  if (
    accountsRes.error &&
    /include_in_total|schema cache|column/i.test(accountsRes.error.message)
  ) {
    usedIncludeColumn = false;
    usedSortColumn = false;
    accountsRes = await supabase
      .from("accounts")
      .select("id,budget_id,name,account_type,currency")
      .eq("budget_id", budget.id)
      .order("name");
  }

  const txnsRes = await supabase
    .from("transactions")
    .select("account_id,amount_cents")
    .eq("budget_id", budget.id);

  assertNoError(accountsRes.error, "Failed to load accounts");
  assertNoError(txnsRes.error, "Failed to load account balances");

  const accounts = (accountsRes.data ?? []) as Array<
    Account & { include_in_total?: boolean; sort_order?: number }
  >;
  const txns = txnsRes.data;

  const balances = new Map<string, number>();
  for (const txn of txns ?? []) {
    const id = txn.account_id as string;
    balances.set(id, (balances.get(id) ?? 0) + (txn.amount_cents as number));
  }

  const cookieExcluded = usedIncludeColumn
    ? new Set<string>()
    : await readExcludedAccountIds(budget.id);

  const mapped = accounts.map((account, index) => ({
    ...account,
    include_in_total: usedIncludeColumn
      ? account.include_in_total !== false
      : !cookieExcluded.has(account.id),
    sort_order: usedSortColumn
      ? Number(account.sort_order ?? index)
      : index,
    balanceCents: balances.get(account.id) ?? 0,
  }));

  // Keep the same stable order the reorder action uses (sort_order → name → id).
  mapped.sort((a, b) => {
    if (usedSortColumn && a.sort_order !== b.sort_order) {
      return a.sort_order - b.sort_order;
    }
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
  return mapped;
});

export const getAccountRegister = cache(async (accountId: string): Promise<{
  account: Account | null;
  transactions: Transaction[];
  balanceCents: number;
  categories: Array<{ id: string; name: string; groupName: string }>;
  accounts: Array<{ id: string; name: string }>;
  matchSuggestions: Array<{
    id: string;
    amountDiffCents: number;
    manual: {
      id: string;
      payee: string;
      occurred_on: string;
      amount_cents: number;
    };
    bank: {
      id: string;
      payee: string;
      occurred_on: string;
      amount_cents: number;
    };
  }>;
}> => {
  const { supabase, budget } = await requireBudget("viewer");

  const [
    accountRes,
    transactionsRes,
    balanceRes,
    categoriesRes,
    groupsRes,
    suggestionsRes,
    accountsRes,
  ] = await Promise.all([
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
      supabase
        .from("transaction_match_suggestions")
        .select(
          "id,amount_diff_cents,manual_transaction_id,bank_transaction_id",
        )
        .eq("budget_id", budget.id)
        .eq("account_id", accountId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("accounts")
        .select("id,name")
        .eq("budget_id", budget.id)
        .order("name"),
    ]);

  assertNoError(accountRes.error, "Failed to load account");
  assertNoError(transactionsRes.error, "Failed to load register");
  assertNoError(balanceRes.error, "Failed to load balance");
  assertNoError(categoriesRes.error, "Failed to load categories");
  assertNoError(groupsRes.error, "Failed to load category groups");
  assertNoError(accountsRes.error, "Failed to load accounts");
  // Suggestions table may not exist until migration is applied.
  if (
    suggestionsRes.error &&
    !/does not exist|schema cache|relation/i.test(suggestionsRes.error.message)
  ) {
    assertNoError(suggestionsRes.error, "Failed to load match suggestions");
  }

  const account = accountRes.data;
  const transactions = transactionsRes.data;
  const balanceRows = balanceRes.data;
  const categories = categoriesRes.data;
  const groups = groupsRes.data;
  const allAccounts = accountsRes.data;

  const groupMap = new Map((groups ?? []).map((g) => [g.id as string, g.name as string]));
  const balanceCents = (balanceRows ?? []).reduce(
    (sum, row) => sum + (row.amount_cents as number),
    0,
  );

  const txnById = new Map(
    ((transactions as Transaction[] | null) ?? []).map((txn) => [txn.id, txn]),
  );

  const missingIds = [
    ...new Set(
      (suggestionsRes.data ?? []).flatMap((row) => [
        row.manual_transaction_id as string,
        row.bank_transaction_id as string,
      ]),
    ),
  ].filter((id) => !txnById.has(id));

  if (missingIds.length > 0) {
    const { data: extraTxns } = await supabase
      .from("transactions")
      .select("id,payee,occurred_on,amount_cents")
      .eq("budget_id", budget.id)
      .eq("account_id", accountId)
      .in("id", missingIds);
    for (const txn of extraTxns ?? []) {
      txnById.set(txn.id as string, txn as Transaction);
    }
  }

  const matchSuggestions = (suggestionsRes.data ?? [])
    .map((row) => {
      const manual = txnById.get(row.manual_transaction_id as string);
      const bank = txnById.get(row.bank_transaction_id as string);
      if (!manual || !bank) return null;
      return {
        id: row.id as string,
        amountDiffCents: (row.amount_diff_cents as number) ?? 0,
        manual: {
          id: manual.id,
          payee: manual.payee,
          occurred_on: manual.occurred_on,
          amount_cents: manual.amount_cents,
        },
        bank: {
          id: bank.id,
          payee: bank.payee,
          occurred_on: bank.occurred_on,
          amount_cents: bank.amount_cents,
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return {
    account: (account as Account | null) ?? null,
    transactions: (transactions as Transaction[] | null) ?? [],
    balanceCents,
    categories: (categories ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      groupName: groupMap.get(c.group_id as string) ?? "Ungrouped",
    })),
    accounts: (allAccounts ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
    })),
    matchSuggestions,
  };
});

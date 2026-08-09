export type BudgetRole = "owner" | "admin" | "editor" | "viewer";

export type Budget = {
  id: string;
  name: string;
  created_by: string;
};

export type BudgetMember = {
  id: string;
  budget_id: string;
  user_id: string;
  role: BudgetRole;
  display_name?: string | null;
};

export type Account = {
  id: string;
  budget_id: string;
  name: string;
  account_type: "checking" | "savings" | "credit" | "cash" | "other";
  currency: string;
  include_in_total?: boolean;
  sort_order?: number;
};

export type CategoryGroup = {
  id: string;
  budget_id: string;
  name: string;
  sort_order: number;
  hidden: boolean;
};

export type AssignMode = "percent" | "fixed";

export type Category = {
  id: string;
  budget_id: string;
  group_id: string;
  name: string;
  sort_order: number;
  hidden: boolean;
  assign_percent?: number;
  assign_mode?: AssignMode;
  assign_fixed_cents?: number;
  /** Auto Priority (AP): 0 = off; lower positive numbers fund first. */
  assign_priority?: number;
  /** When true, Fix Now will not pull from this category. */
  exclude_from_overspend_cover?: boolean;
};

export type CategoryMonth = {
  category_id: string;
  month: string;
  assigned_cents: number;
};

export type Transaction = {
  id: string;
  budget_id: string;
  account_id: string;
  category_id: string | null;
  occurred_on: string;
  payee: string;
  memo: string;
  amount_cents: number;
  cleared: boolean;
  /** When true, excluded from balances, budget activity, and insights. */
  ignored?: boolean;
  external_id?: string | null;
};

export type GoalFrequency = "weekly" | "monthly" | "quarterly" | "yearly" | "once";

export type CategoryGoal = {
  goalCents: number | null;
  goalName: string;
  goalFrequency: GoalFrequency;
  goalNote: string;
  /** ISO date YYYY-MM-DD when a due date is enabled; null otherwise. */
  goalDueOn: string | null;
};

export type BudgetRow = {
  categoryId: string;
  groupId: string;
  groupName: string;
  groupSortOrder: number;
  categoryName: string;
  categorySortOrder: number;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
  assignPercent: number;
  assignMode: AssignMode;
  assignFixedCents: number;
  /** Auto Priority (AP): 0 = off; lower positive numbers fund first. */
  assignPriority: number;
  /** When true, Fix Now will not offer this category as a funding source. */
  excludeFromOverspendCover: boolean;
} & CategoryGoal;

export type BudgetSnapshotTxn = {
  id: string;
  occurredOn: string;
  payee: string;
  memo: string;
  amountCents: number;
  categoryName: string | null;
  accountName: string;
};

export type BudgetSnapshot = {
  kind: "month" | "day";
  month: string;
  date: string | null;
  label: string;
  readyToAssignCents: number;
  totalMoneyCents: number;
  activityCents: number;
  incomeCents: number;
  spendingCents: number;
  rows: BudgetRow[];
  transactions: BudgetSnapshotTxn[];
};

export type TrendFinding = {
  id: string;
  kind: string;
  severity: "info" | "watch" | "alert";
  title: string;
  summary: string;
  metrics: Record<string, number | string>;
  relatedIds: string[];
  createdAt: string;
};

export type TipCard = {
  id: string;
  findingId: string;
  headline: string;
  body: string;
  actions: Array<{ label: string; href?: string }>;
  llmVersion?: string | null;
};

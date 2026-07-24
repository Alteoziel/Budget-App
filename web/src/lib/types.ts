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
};

export type CategoryGroup = {
  id: string;
  budget_id: string;
  name: string;
  sort_order: number;
  hidden: boolean;
};

export type Category = {
  id: string;
  budget_id: string;
  group_id: string;
  name: string;
  sort_order: number;
  hidden: boolean;
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
  external_id?: string | null;
};

export type BudgetRow = {
  categoryId: string;
  groupId: string;
  groupName: string;
  categoryName: string;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
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

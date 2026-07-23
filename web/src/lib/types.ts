export type Account = {
  id: string;
  name: string;
  account_type: "checking" | "savings" | "credit" | "cash" | "other";
  currency: string;
};

export type CategoryGroup = {
  id: string;
  name: string;
  sort_order: number;
  hidden: boolean;
};

export type Category = {
  id: string;
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
  account_id: string;
  category_id: string | null;
  occurred_on: string;
  payee: string;
  memo: string;
  amount_cents: number;
  cleared: boolean;
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

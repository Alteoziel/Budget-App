export type OfflineSnapshot = {
  version: 1;
  savedAt: string;
  budget: { id: string; name: string };
  readyToAssignCents: number;
  month: string;
  accounts: Array<{
    id: string;
    name: string;
    account_type: string;
    balanceCents: number;
  }>;
  categories: Array<{
    id: string;
    name: string;
    groupName: string;
    availableCents: number;
    assignedCents: number;
    activityCents: number;
  }>;
  recentTransactions: Array<{
    id: string;
    account_id: string;
    accountName: string;
    category_id: string | null;
    categoryName: string | null;
    occurred_on: string;
    payee: string;
    memo: string;
    amount_cents: number;
  }>;
};

export type OfflineOutboxItem = {
  id: string;
  createdAt: string;
  kind: "create_transaction";
  payload: {
    account_id: string;
    category_id: string;
    occurred_on: string;
    payee: string;
    memo: string;
    amount: string;
    direction: "inflow" | "outflow";
  };
};

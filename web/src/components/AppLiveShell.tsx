"use client";

import { BankSyncOnOpen } from "@/components/BankSyncOnOpen";
import { BudgetRealtimeProvider } from "@/components/BudgetRealtimeProvider";

/** Wraps authenticated chrome so header presence + page live refresh share one channel. */
export function AppLiveShell({
  budgetId,
  userId,
  displayName,
  bankSyncOnOpen = false,
  children,
}: {
  budgetId?: string | null;
  userId?: string | null;
  displayName?: string | null;
  /** When true, open/resume runs a manual-style Plaid sync. */
  bankSyncOnOpen?: boolean;
  children: React.ReactNode;
}) {
  if (!budgetId || !userId) {
    return <>{children}</>;
  }

  return (
    <BudgetRealtimeProvider
      budgetId={budgetId}
      userId={userId}
      displayName={displayName || "You"}
    >
      {bankSyncOnOpen ? (
        <BankSyncOnOpen budgetId={budgetId} enabled />
      ) : null}
      {children}
    </BudgetRealtimeProvider>
  );
}

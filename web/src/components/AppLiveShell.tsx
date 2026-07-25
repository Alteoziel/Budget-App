"use client";

import { BudgetRealtimeProvider } from "@/components/BudgetRealtimeProvider";

/** Wraps authenticated chrome so header presence + page live refresh share one channel. */
export function AppLiveShell({
  budgetId,
  userId,
  displayName,
  children,
}: {
  budgetId?: string | null;
  userId?: string | null;
  displayName?: string | null;
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
      {children}
    </BudgetRealtimeProvider>
  );
}

import { after } from "next/server";
import { DesktopSideNav, MobileBottomNav } from "@/components/AppNav";
import { AppLiveShell } from "@/components/AppLiveShell";
import { AppOfflineShell } from "@/components/AppOfflineShell";
import { BudgetSwitcher } from "@/components/BudgetSwitcher";
import { CollaboratorsBadge } from "@/components/CollaboratorsBadge";
import { listUserBudgets, resolveActiveBudget } from "@/lib/budget-context";
import { catchUpStalePlaidSyncForBudget } from "@/lib/plaid/catch-up";
import { plaidConfigured } from "@/lib/plaid/client";
import { createClient } from "@/lib/supabase/server";

/** Shared authenticated chrome — lives in the layout so tab switches reuse it. */
export async function AppChrome({ children }: { children: React.ReactNode }) {
  const [active, budgets] = await Promise.all([
    resolveActiveBudget(),
    listUserBudgets(),
  ]);

  let displayName = "You";
  if (active) {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", active.userId)
      .maybeSingle();
    displayName = profile?.display_name?.trim() || "You";

    // If the daily cron missed, catch up after the page is sent so open-app
    // still refreshes bank data without blocking navigation.
    if (plaidConfigured()) {
      const budgetId = active.budget.id;
      after(() => {
        void catchUpStalePlaidSyncForBudget(budgetId);
      });
    }
  }

  return (
    <AppLiveShell
      budgetId={active?.budget.id}
      userId={active?.userId}
      displayName={displayName}
    >
      {/*
        Full-viewport flex shell keeps the mobile tab bar in normal flow at the
        bottom. `position: fixed` was leaving a gap under the tabs after long
        server actions (Sync now) when the mobile visual viewport resettled.
      */}
      <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-app-glow">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1">
          <DesktopSideNav />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
            <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-moss-500 sm:text-xs">
                  Alte&apos; Budgeting
                </p>
                {active ? (
                  <div className="mt-2 max-w-xs">
                    <BudgetSwitcher budgets={budgets} activeId={active.budget.id} />
                  </div>
                ) : null}
              </div>
              {active ? (
                <div className="shrink-0 pt-1">
                  <CollaboratorsBadge />
                </div>
              ) : null}
            </header>
            <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-8 pt-2 sm:px-6 lg:mx-0 lg:max-w-3xl lg:px-8 lg:pb-10">
              {active ? (
                <AppOfflineShell
                  userId={active.userId}
                  budgetId={active.budget.id}
                >
                  {children}
                </AppOfflineShell>
              ) : (
                children
              )}
            </main>
          </div>
        </div>
        <MobileBottomNav />
      </div>
    </AppLiveShell>
  );
}

import { DesktopSideNav, MobileBottomNav } from "@/components/AppNav";
import { BudgetSwitcher } from "@/components/BudgetSwitcher";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import { signOutAction } from "@/lib/actions";
import { listUserBudgets, resolveActiveBudget } from "@/lib/budget-context";

/** Shared authenticated chrome — lives in the layout so tab switches reuse it. */
export async function AppChrome({ children }: { children: React.ReactNode }) {
  const [active, budgets] = await Promise.all([
    resolveActiveBudget(),
    listUserBudgets(),
  ]);

  return (
    <div className="min-h-dvh bg-app-glow">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl">
        <DesktopSideNav />
        <div className="flex min-w-0 flex-1 flex-col">
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
            <form action={signOutAction} className="shrink-0">
              <PendingSubmitButton
                pendingLabel="…"
                className="min-h-11 rounded-xl px-3 py-2 text-sm font-semibold text-ink-600 hover:bg-sand-100 active:bg-sand-200"
              >
                Sign out
              </PendingSubmitButton>
            </form>
          </header>
          <main className="safe-pb mx-auto w-full max-w-lg flex-1 px-4 pb-8 pt-2 sm:px-6 lg:mx-0 lg:max-w-3xl lg:px-8 lg:pb-10">
            {children}
          </main>
        </div>
      </div>
      <MobileBottomNav />
    </div>
  );
}

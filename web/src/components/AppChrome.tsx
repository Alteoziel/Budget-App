import { BottomNav } from "@/components/BottomNav";
import { BudgetSwitcher } from "@/components/BudgetSwitcher";
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
      <header className="mx-auto flex max-w-lg items-start justify-between gap-4 px-5 pb-2 pt-6">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-moss-500">
            Alte&apos; Budgeting
          </p>
          {active ? (
            <div className="mt-2">
              <BudgetSwitcher budgets={budgets} activeId={active.budget.id} />
            </div>
          ) : null}
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-xl px-3 py-2 text-sm font-semibold text-ink-600 hover:bg-sand-100"
          >
            Sign out
          </button>
        </form>
      </header>
      <main className="safe-pb mx-auto max-w-lg px-5 pb-8 pt-2">{children}</main>
      <BottomNav />
    </div>
  );
}

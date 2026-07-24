"use client";

import { switchBudgetAction } from "@/lib/actions";
import type { BudgetRole } from "@/lib/types";

export function BudgetSwitcher({
  budgets,
  activeId,
}: {
  budgets: Array<{ id: string; name: string; role: BudgetRole }>;
  activeId: string;
}) {
  if (budgets.length <= 1) {
    const only = budgets[0];
    return (
      <p className="text-xs font-semibold text-ink-600">
        {only?.name ?? "Budget"}
        {only ? ` · ${only.role}` : ""}
      </p>
    );
  }

  return (
    <form action={switchBudgetAction}>
      <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-600">
        Budget
        <select
          name="budget_id"
          defaultValue={activeId}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="mt-1 w-full max-w-[12rem] rounded-lg border border-ink-900/10 bg-white px-2 py-1.5 text-sm font-semibold text-ink-900 outline-none ring-moss-400 focus:ring-2"
        >
          {budgets.map((budget) => (
            <option key={budget.id} value={budget.id}>
              {budget.name} ({budget.role})
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}

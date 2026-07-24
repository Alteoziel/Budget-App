import { AddCategoryForm } from "@/components/AddCategoryForm";
import { AppShell } from "@/components/AppShell";
import { BudgetManager } from "@/components/BudgetManager";
import { FlashError } from "@/components/FlashError";
import { Money } from "@/components/Money";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import { autoAssignAction } from "@/lib/actions";
import { getBudgetRows } from "@/lib/budget-data";
import { formatBudgetMonth } from "@/lib/money";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; assigned?: string }>;
}) {
  const params = await searchParams;
  const { month, rows, readyToAssignCents, groups: allGroups } = await getBudgetRows();

  const groupMap = new Map<
    string,
    { groupId: string; groupName: string; categories: typeof rows }
  >();
  for (const row of rows) {
    const existing = groupMap.get(row.groupId);
    if (existing) {
      existing.categories.push(row);
    } else {
      groupMap.set(row.groupId, {
        groupId: row.groupId,
        groupName: row.groupName,
        categories: [row],
      });
    }
  }
  const groups = [...groupMap.values()];
  const assignedCents = params.assigned ? Number(params.assigned) : null;

  return (
    <AppShell title="Budget" subtitle={formatBudgetMonth(month)}>
      <FlashError message={params.error} />
      {assignedCents != null && Number.isFinite(assignedCents) ? (
        <p className="mb-3 rounded-2xl bg-moss-500/15 px-3 py-2 text-sm font-semibold text-ink-800">
          Auto-assigned <Money cents={assignedCents} /> across categories.
        </p>
      ) : null}
      <section className="animate-rise rounded-3xl bg-ink-900 px-5 py-5 text-sand-50 shadow-soft">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-moss-300">
          Ready to assign
        </p>
        <p className="mt-2 font-display text-4xl font-bold">
          <Money cents={readyToAssignCents} className="text-sand-50" />
        </p>
        <p className="mt-2 text-sm text-sand-200">
          Assign dollars to categories until this hits zero — or use Auto-assign with your
          percentages.
        </p>
        <form action={autoAssignAction} className="mt-4">
          <input type="hidden" name="month" value={month} />
          <PendingSubmitButton
            pendingLabel="Assigning…"
            className="min-h-11 w-full rounded-2xl bg-moss-500 px-4 py-3 text-sm font-bold text-sand-50 disabled:opacity-60 sm:w-auto"
          >
            Auto-assign
          </PendingSubmitButton>
        </form>
      </section>

      <section className="animate-rise-delay mt-6">
        <BudgetManager month={month} groups={groups} />
      </section>

      <section className="mt-6 rounded-3xl border border-ink-900/5 bg-sand-50/80 p-4 shadow-soft">
        <h2 className="font-display text-lg font-bold text-ink-900">Add category</h2>
        <AddCategoryForm groups={allGroups} />
      </section>
    </AppShell>
  );
}

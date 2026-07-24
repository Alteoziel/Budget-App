import { AppShell } from "@/components/AppShell";
import { BudgetManager } from "@/components/BudgetManager";
import { FlashError } from "@/components/FlashError";
import { Money } from "@/components/Money";
import { createCategoryAction } from "@/lib/actions";
import { getBudgetRows } from "@/lib/budget-data";
import { formatBudgetMonth } from "@/lib/money";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const { month, rows, readyToAssignCents } = await getBudgetRows();

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

  return (
    <AppShell title="Budget" subtitle={formatBudgetMonth(month)}>
      <FlashError message={params.error} />
      <section className="animate-rise rounded-3xl bg-ink-900 px-5 py-5 text-sand-50 shadow-soft">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-moss-300">
          Ready to assign
        </p>
        <p className="mt-2 font-display text-4xl font-bold">
          <Money cents={readyToAssignCents} className="text-sand-50" />
        </p>
        <p className="mt-2 text-sm text-sand-200">
          Assign dollars to categories until this hits zero.
        </p>
      </section>

      <section className="animate-rise-delay mt-6">
        <BudgetManager month={month} groups={groups} />
      </section>

      <section className="mt-6 rounded-3xl border border-ink-900/5 bg-sand-50/80 p-4 shadow-soft">
        <h2 className="font-display text-lg font-bold text-ink-900">Add category</h2>
        <form action={createCategoryAction} className="mt-3 space-y-3">
          <label className="block text-sm font-semibold text-ink-700">
            Group
            <input
              name="group_name"
              placeholder="Everyday"
              className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
            />
          </label>
          <label className="block text-sm font-semibold text-ink-700">
            Category
            <input
              required
              name="category_name"
              placeholder="Groceries"
              className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 hover:bg-ink-800"
          >
            Add category
          </button>
        </form>
      </section>
    </AppShell>
  );
}

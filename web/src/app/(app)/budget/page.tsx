import { AppShell } from "@/components/AppShell";
import { FlashError } from "@/components/FlashError";
import { Money } from "@/components/Money";
import {
  assignCategoryAction,
  createCategoryAction,
} from "@/lib/actions";
import { getBudgetRows } from "@/lib/budget-data";
import { formatBudgetMonth } from "@/lib/money";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const { month, rows, readyToAssignCents } = await getBudgetRows();

  const grouped = rows.reduce<Record<string, typeof rows>>((acc, row) => {
    acc[row.groupName] ??= [];
    acc[row.groupName].push(row);
    return acc;
  }, {});

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

      <section className="animate-rise-delay mt-6 space-y-4">
        {Object.keys(grouped).length === 0 ? (
          <div className="rounded-3xl border border-dashed border-ink-900/15 bg-sand-50/70 px-4 py-8 text-center">
            <p className="font-display text-xl font-bold text-ink-900">No categories yet</p>
            <p className="mt-2 text-sm text-ink-600">
              Add a category below, or import your YNAB CSV.
            </p>
          </div>
        ) : (
          Object.entries(grouped).map(([groupName, categories]) => (
            <div key={groupName} className="overflow-hidden rounded-3xl bg-sand-50/80 shadow-soft">
              <div className="border-b border-ink-900/5 px-4 py-3">
                <h2 className="font-display text-lg font-bold text-ink-900">{groupName}</h2>
              </div>
              <ul className="divide-y divide-ink-900/5">
                {categories.map((row) => (
                  <li key={row.categoryId} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink-900">{row.categoryName}</p>
                        <p className="mt-1 text-xs text-ink-600">
                          Activity <Money cents={row.activityCents} />
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold uppercase tracking-wide text-ink-600">
                          Available
                        </p>
                        <p className="font-bold">
                          <Money cents={row.availableCents} />
                        </p>
                      </div>
                    </div>
                    <form action={assignCategoryAction} className="mt-3 flex items-end gap-2">
                      <input type="hidden" name="category_id" value={row.categoryId} />
                      <input type="hidden" name="month" value={month} />
                      <label className="flex-1 text-xs font-semibold text-ink-600">
                        Assigned
                        <input
                          name="assigned"
                          inputMode="decimal"
                          defaultValue={(row.assignedCents / 100).toFixed(2)}
                          className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                        />
                      </label>
                      <button
                        type="submit"
                        className="rounded-xl bg-moss-500 px-3 py-2 text-sm font-bold text-sand-50 hover:bg-moss-400"
                      >
                        Save
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
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

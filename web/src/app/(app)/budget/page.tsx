import { AddCategoryForm } from "@/components/AddCategoryForm";
import { AppShell } from "@/components/AppShell";
import { BudgetManager } from "@/components/BudgetManager";
import { BudgetOverview } from "@/components/BudgetOverview";
import { FlashError } from "@/components/FlashError";
import { getBudgetRows } from "@/lib/budget-data";
import { formatBudgetMonth, formatCents } from "@/lib/money";

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
        <FlashError
          tone="success"
          message={`Auto-assigned ${formatCents(assignedCents)} across categories.`}
        />
      ) : null}
      <BudgetOverview
        month={month}
        rows={rows}
        readyToAssignCents={readyToAssignCents}
      />

      <section className="animate-rise-delay mt-4">
        <BudgetManager month={month} groups={groups} />
      </section>

      <section className="card-surface mt-4 rounded-2xl p-4">
        <h2 className="font-display text-base font-bold text-ink-900">Add category</h2>
        <AddCategoryForm groups={allGroups} />
      </section>
    </AppShell>
  );
}

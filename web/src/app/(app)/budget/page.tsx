import { AddCategoryForm } from "@/components/AddCategoryForm";
import { AppShell } from "@/components/AppShell";
import { BudgetCalendarPicker } from "@/components/BudgetCalendarPicker";
import { BudgetManager } from "@/components/BudgetManager";
import { BudgetOverview } from "@/components/BudgetOverview";
import { BudgetSnapshotPanel } from "@/components/BudgetSnapshotPanel";
import { FlashError } from "@/components/FlashError";
import { getBudgetRows, getBudgetSnapshot } from "@/lib/budget-data";
import {
  currentBudgetMonth,
  formatBudgetDate,
  formatBudgetMonth,
  formatCents,
  isBudgetMonth,
  isValidIsoDate,
} from "@/lib/money";

function resolveAsParam(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (isValidIsoDate(value)) return value;
  if (isBudgetMonth(value)) return value;
  return null;
}

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; assigned?: string; as?: string }>;
}) {
  const params = await searchParams;
  const as = resolveAsParam(params.as);
  const liveMonth = currentBudgetMonth();

  // Current month (no day) stays editable; past months and any day are snapshots.
  const showSnapshot =
    as != null && !(isBudgetMonth(as) && as === liveMonth);

  if (showSnapshot && as) {
    const snapshot = await getBudgetSnapshot(as);
    if (!snapshot) {
      return (
        <AppShell
          title="Budget"
          subtitle={
            <BudgetCalendarPicker
              selectedAs={null}
              currentMonth={liveMonth}
              buttonLabel={formatBudgetMonth(liveMonth)}
            />
          }
        >
          <FlashError message="That date could not be loaded." />
        </AppShell>
      );
    }

    const buttonLabel =
      snapshot.kind === "day" && snapshot.date
        ? formatBudgetDate(snapshot.date)
        : formatBudgetMonth(snapshot.month);

    return (
      <AppShell
        title="Budget"
        subtitle={
          <BudgetCalendarPicker
            selectedAs={as}
            currentMonth={liveMonth}
            buttonLabel={buttonLabel}
          />
        }
      >
        <BudgetSnapshotPanel snapshot={snapshot} />
      </AppShell>
    );
  }

  const { month, rows, readyToAssignCents, groups: allGroups } =
    await getBudgetRows();

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
    <AppShell
      title="Budget"
      subtitle={
        <BudgetCalendarPicker
          selectedAs={null}
          currentMonth={liveMonth}
          buttonLabel={formatBudgetMonth(month)}
        />
      }
    >
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

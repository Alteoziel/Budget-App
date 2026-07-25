import { AppShell } from "@/components/AppShell";
import { BudgetCalendarPicker } from "@/components/BudgetCalendarPicker";
import { BudgetLiveView } from "@/components/BudgetLiveView";
import { BudgetSnapshotPanel } from "@/components/BudgetSnapshotPanel";
import { FlashError } from "@/components/FlashError";
import { getBudgetRows, getBudgetSnapshot } from "@/lib/budget-data";
import {
  currentBudgetMonth,
  formatBudgetDate,
  formatBudgetMonth,
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
    <BudgetLiveView
      month={month}
      liveMonth={liveMonth}
      groups={groups}
      allGroups={allGroups}
      rows={rows}
      readyToAssignCents={readyToAssignCents}
      error={params.error}
      assignedCents={
        assignedCents != null && Number.isFinite(assignedCents)
          ? assignedCents
          : null
      }
    />
  );
}

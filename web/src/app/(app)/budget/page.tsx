import { AppShell } from "@/components/AppShell";
import { BudgetCalendarPicker } from "@/components/BudgetCalendarPicker";
import { BudgetLiveView } from "@/components/BudgetLiveView";
import { BudgetSnapshotPanel } from "@/components/BudgetSnapshotPanel";
import { FlashError } from "@/components/FlashError";
import { getBudgetRows, getBudgetSnapshot } from "@/lib/budget-data";
import {
  currentBudgetMonth,
  currentIsoDate,
  formatBudgetDate,
  formatBudgetMonth,
  isBudgetMonth,
  isValidIsoDate,
  maxAssignableBudgetMonth,
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
  const today = currentIsoDate();
  const maxFutureMonth = maxAssignableBudgetMonth(liveMonth);

  // Future calendar days are not valid views.
  if (as && isValidIsoDate(as) && as > today) {
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
        <FlashError message="Future days can’t be opened yet — pick a month to assign ahead." />
      </AppShell>
    );
  }

  // Future months beyond the assignable window.
  if (
    as &&
    isBudgetMonth(as) &&
    maxFutureMonth &&
    as > maxFutureMonth
  ) {
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
        <FlashError message="That month is too far ahead to assign into." />
      </AppShell>
    );
  }

  // Past months and any day are read-only snapshots. Current + future months
  // are editable so you can put Ready to assign toward upcoming categories.
  const showSnapshot =
    as != null &&
    ((isBudgetMonth(as) && as < liveMonth) || isValidIsoDate(as));

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

  const editableMonth =
    as && isBudgetMonth(as) && as >= liveMonth ? as : liveMonth;

  const { month, rows, readyToAssignCents, groups: allGroups } =
    await getBudgetRows(editableMonth);

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

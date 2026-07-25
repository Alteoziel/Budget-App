"use client";

import { useMemo, useState } from "react";
import { AddCategoryForm } from "@/components/AddCategoryForm";
import { AppShell } from "@/components/AppShell";
import { BudgetCalendarPicker } from "@/components/BudgetCalendarPicker";
import { BudgetManager } from "@/components/BudgetManager";
import { BudgetOverview } from "@/components/BudgetOverview";
import { FlashError } from "@/components/FlashError";
import { formatBudgetMonth, formatCents } from "@/lib/money";
import type { BudgetRow } from "@/lib/types";

type GroupBlock = {
  groupId: string;
  groupName: string;
  categories: BudgetRow[];
};

const miniBtnClass =
  "min-h-9 touch-manipulation rounded-xl border border-ink-900/10 bg-sand-50 px-2.5 py-1.5 text-xs font-bold text-ink-700 shadow-sm transition hover:border-ink-900/20 hover:bg-white dark:bg-ink-50";

export function BudgetLiveView({
  month,
  liveMonth,
  groups,
  allGroups,
  rows,
  readyToAssignCents,
  error,
  assignedCents,
}: {
  month: string;
  liveMonth: string;
  groups: GroupBlock[];
  allGroups: Array<{ id: string; name: string }>;
  rows: BudgetRow[];
  readyToAssignCents: number;
  error?: string;
  assignedCents: number | null;
}) {
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const groupIds = useMemo(
    () => groups.map((group) => group.groupId),
    [groups],
  );

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
      actions={
        groups.length > 0 ? (
          <div className="flex flex-col items-end gap-1.5 sm:flex-row">
            <button
              type="button"
              onClick={() => setCollapsedGroupIds(new Set())}
              className={miniBtnClass}
              aria-label="Expand all groups"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => setCollapsedGroupIds(new Set(groupIds))}
              className={miniBtnClass}
              aria-label="Collapse all groups"
            >
              Collapse all
            </button>
          </div>
        ) : null
      }
    >
      <FlashError message={error} />
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
        <BudgetManager
          month={month}
          groups={groups}
          collapsedGroupIds={collapsedGroupIds}
          onCollapsedGroupIdsChange={setCollapsedGroupIds}
        />
      </section>

      <section className="card-surface mt-4 rounded-2xl p-4">
        <h2 className="font-display text-base font-bold text-ink-900">Add category</h2>
        <AddCategoryForm groups={allGroups} />
      </section>
    </AppShell>
  );
}

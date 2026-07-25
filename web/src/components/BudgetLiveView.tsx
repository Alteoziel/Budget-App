"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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

type BudgetFilter = "overspent" | "underGoal" | "hasActivity" | "zeroAssigned";

const FILTER_OPTIONS: Array<{ id: BudgetFilter; label: string; hint: string }> = [
  {
    id: "overspent",
    label: "Overspent",
    hint: "Available is below zero",
  },
  {
    id: "underGoal",
    label: "Under goal",
    hint: "Has a goal and isn’t fully funded",
  },
  {
    id: "hasActivity",
    label: "Has activity",
    hint: "Spending or income this month",
  },
  {
    id: "zeroAssigned",
    label: "Nothing assigned",
    hint: "Assigned amount is $0",
  },
];

const miniBtnClass =
  "min-h-9 touch-manipulation rounded-xl border border-ink-900/10 bg-sand-50 px-2.5 py-1.5 text-xs font-bold text-ink-700 shadow-sm transition hover:border-ink-900/20 hover:bg-white dark:bg-ink-50";

function rowMatchesFilters(row: BudgetRow, filters: Set<BudgetFilter>): boolean {
  if (filters.size === 0) return true;
  for (const filter of filters) {
    if (filter === "overspent" && !(row.availableCents < 0)) return false;
    if (
      filter === "underGoal" &&
      !(row.goalCents != null && row.availableCents < row.goalCents)
    ) {
      return false;
    }
    if (filter === "hasActivity" && row.activityCents === 0) return false;
    if (filter === "zeroAssigned" && row.assignedCents !== 0) return false;
  }
  return true;
}

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
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [filters, setFilters] = useState<Set<BudgetFilter>>(() => new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const filtersPanelId = useId();

  const groupIds = useMemo(
    () => groups.map((group) => group.groupId),
    [groups],
  );

  const filteredGroups = useMemo(() => {
    if (filters.size === 0) return groups;
    return groups
      .map((group) => ({
        ...group,
        categories: group.categories.filter((row) =>
          rowMatchesFilters(row, filters),
        ),
      }))
      .filter((group) => group.categories.length > 0);
  }, [groups, filters]);

  useEffect(() => {
    if (!filtersOpen) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (target && filtersRef.current && !filtersRef.current.contains(target)) {
        setFiltersOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersOpen]);

  function toggleFilter(id: BudgetFilter) {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
            <div ref={filtersRef} className="relative">
              <button
                type="button"
                aria-expanded={filtersOpen}
                aria-controls={filtersPanelId}
                onClick={() => setFiltersOpen((value) => !value)}
                className={`${miniBtnClass} ${
                  filters.size > 0
                    ? "border-moss-500/40 bg-moss-500/10 text-moss-800 dark:text-moss-200"
                    : ""
                }`}
              >
                Filters{filters.size > 0 ? ` · ${filters.size}` : ""}
              </button>
              {filtersOpen ? (
                <div
                  id={filtersPanelId}
                  role="dialog"
                  aria-label="Budget filters"
                  className="absolute right-0 z-40 mt-2 w-64 rounded-2xl border border-ink-900/15 bg-sand-50 p-3 shadow-soft dark:bg-ink-50"
                >
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">
                    Show categories that
                  </p>
                  <ul className="mt-2 space-y-1">
                    {FILTER_OPTIONS.map((option) => {
                      const on = filters.has(option.id);
                      return (
                        <li key={option.id}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleFilter(option.id)}
                            className={`flex w-full touch-manipulation flex-col rounded-xl px-3 py-2 text-left transition ${
                              on
                                ? "bg-moss-500 text-sand-50"
                                : "hover:bg-ink-900/5"
                            }`}
                          >
                            <span className="text-xs font-bold">{option.label}</span>
                            <span
                              className={`text-[11px] ${
                                on ? "opacity-80" : "text-ink-500"
                              }`}
                            >
                              {option.hint}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {filters.size > 0 ? (
                    <button
                      type="button"
                      onClick={() => setFilters(new Set())}
                      className="mt-2 w-full touch-manipulation rounded-xl bg-ink-900/5 px-3 py-2 text-xs font-bold text-ink-700 hover:bg-ink-900/10"
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
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
        {filters.size > 0 && filteredGroups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-900/20 bg-sand-50 px-4 py-8 text-center">
            <p className="font-display text-lg font-bold text-ink-900">
              No categories match
            </p>
            <p className="mt-2 text-sm text-ink-600">
              Clear or change filters to see more of your budget.
            </p>
            <button
              type="button"
              onClick={() => setFilters(new Set())}
              className="mt-4 min-h-11 rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-sand-50"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <BudgetManager
            month={month}
            groups={filteredGroups}
            collapsedGroupIds={collapsedGroupIds}
            onCollapsedGroupIdsChange={setCollapsedGroupIds}
          />
        )}
      </section>

      <section className="card-surface mt-4 overflow-hidden rounded-2xl">
        <button
          type="button"
          aria-expanded={addCategoryOpen}
          onClick={() => setAddCategoryOpen((value) => !value)}
          className="flex w-full touch-manipulation items-center justify-between gap-3 px-4 py-3 text-left outline-none ring-moss-400 focus-visible:ring-2 focus-visible:ring-inset"
        >
          <h2 className="font-display text-base font-bold text-ink-900">
            Add category
          </h2>
          <span
            aria-hidden
            className={`shrink-0 text-xs text-ink-500 transition-transform ${
              addCategoryOpen ? "rotate-180" : ""
            }`}
          >
            ▾
          </span>
        </button>
        {addCategoryOpen ? (
          <div className="border-t border-ink-900/8 px-4 pb-4 pt-1">
            <AddCategoryForm groups={allGroups} />
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { InsightsDataset } from "@/lib/insights/dataset";
import {
  deriveCategoryBreakdown,
  deriveCategoryTransactions,
  type CategorySpendRow,
  type FlowKind,
} from "@/lib/insights/derive";
import {
  formatBudgetDate,
  formatBudgetMonth,
  formatCents,
} from "@/lib/money";

const SPENDING_COLORS = [
  "#c45c3a",
  "#3f7a5c",
  "#2a463c",
  "#e08a68",
  "#8fbf9a",
  "#b8502f",
  "#527665",
  "#d9926a",
  "#5a9a75",
  "#8a6a4a",
];

const INCOME_COLORS = [
  "#3f7a5c",
  "#5a9a75",
  "#8fbf9a",
  "#2a463c",
  "#527665",
  "#b7d9bf",
  "#1f4d3a",
  "#7aab88",
  "#4e8064",
  "#c6d6cd",
];

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

type ViewMode = FlowKind | "both";

function monthsForYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

function defaultSelectedMonth(available: string[]): string | null {
  if (!available.length) return null;
  return available[available.length - 1] ?? null;
}

/** Prefer checking accounts; if none exist, select every account. */
function defaultAccountIds(
  accounts: InsightsDataset["accounts"],
): string[] {
  const checking = accounts
    .filter((account) => account.account_type === "checking")
    .map((account) => account.id);
  if (checking.length) return checking;
  return accounts.map((account) => account.id);
}

type Drilldown = {
  categoryId: string | null;
  name: string;
  flow: FlowKind;
};

export function MonthSpendingBreakdown({
  dataset,
}: {
  dataset: InsightsDataset;
}) {
  const available = dataset.months;
  const availableSet = useMemo(() => new Set(available), [available]);
  const latest = defaultSelectedMonth(available);
  const [selectedMonths, setSelectedMonths] = useState<string[]>(() =>
    latest ? [latest] : [],
  );
  const [accountIds, setAccountIds] = useState<string[]>(() =>
    defaultAccountIds(dataset.accounts),
  );
  const [viewYear, setViewYear] = useState(() =>
    Number((latest ?? available[0] ?? "2026-01").slice(0, 4)),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

  const years = useMemo(() => {
    const set = new Set(available.map((m) => Number(m.slice(0, 4))));
    return [...set].sort((a, b) => a - b);
  }, [available]);

  const minYear = years[0] ?? viewYear;
  const maxYear = years[years.length - 1] ?? viewYear;

  const spending = useMemo(
    () => deriveCategoryBreakdown(dataset, selectedMonths, accountIds, "spending"),
    [dataset, selectedMonths, accountIds],
  );
  const income = useMemo(
    () => deriveCategoryBreakdown(dataset, selectedMonths, accountIds, "income"),
    [dataset, selectedMonths, accountIds],
  );

  function toggleMonth(month: string) {
    if (!availableSet.has(month)) return;
    setSelectedMonths((prev) => {
      if (prev.includes(month)) {
        return prev.filter((m) => m !== month);
      }
      return [...prev, month].sort();
    });
  }

  function selectOnly(month: string) {
    if (!availableSet.has(month)) return;
    setSelectedMonths([month]);
  }

  function toggleAccount(id: string) {
    setAccountIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  }

  const selectedLabel =
    selectedMonths.length === 0
      ? "No months selected"
      : selectedMonths.length === 1
        ? formatBudgetMonth(selectedMonths[0]!)
        : `${selectedMonths.length} months selected`;

  const checkingDefaults = dataset.accounts
    .filter((account) => account.account_type === "checking")
    .map((account) => account.id);
  const accountsLabel =
    accountIds.length === 0
      ? "No accounts selected"
      : accountIds.length === dataset.accounts.length
        ? "All accounts"
        : accountIds.length === 1
          ? (dataset.accounts.find((a) => a.id === accountIds[0])?.name ??
            "1 account")
          : `${accountIds.length} accounts`;

  const showSpending = viewMode === "spending" || viewMode === "both";
  const showIncome = viewMode === "income" || viewMode === "both";

  return (
    <div className="space-y-4">
      {dataset.accounts.length ? (
        <div className="rounded-2xl border border-moss-500/30 bg-moss-500/10 px-3 py-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-moss-700 dark:text-moss-300">
              Accounts
            </h3>
            <p className="text-[11px] font-semibold text-ink-500">{accountsLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {dataset.accounts.map((account) => {
              const on = accountIds.includes(account.id);
              return (
                <button
                  key={account.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleAccount(account.id)}
                  className={`min-h-11 touch-manipulation rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                    on
                      ? "bg-moss-500 text-sand-50"
                      : "border border-moss-500/25 bg-sand-50 text-moss-800 hover:border-moss-500/40 dark:text-moss-200"
                  }`}
                >
                  {account.name}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setAccountIds(dataset.accounts.map((a) => a.id))}
              className="text-[11px] font-bold text-ink-600 underline-offset-2 hover:underline"
            >
              Select all
            </button>
            {checkingDefaults.length ? (
              <button
                type="button"
                onClick={() => setAccountIds(checkingDefaults)}
                className="text-[11px] font-bold text-ink-600 underline-offset-2 hover:underline"
              >
                Checking only
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-[11px] font-semibold text-ink-500">
            Defaults to checking so transfers between accounts stay out of the totals.
          </p>
        </div>
      ) : null}

      <div className="card-surface rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">
              Months
            </h3>
            <p className="mt-1 text-sm font-semibold text-ink-800">{selectedLabel}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous year"
              disabled={viewYear <= minYear}
              onClick={() => setViewYear((y) => y - 1)}
              className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-xl text-ink-700 hover:bg-ink-900/5 disabled:opacity-30"
            >
              ‹
            </button>
            <span className="min-w-[3.5rem] text-center text-sm font-bold text-ink-900">
              {viewYear}
            </span>
            <button
              type="button"
              aria-label="Next year"
              disabled={viewYear >= maxYear}
              onClick={() => setViewYear((y) => y + 1)}
              className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-xl text-ink-700 hover:bg-ink-900/5 disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {monthsForYear(viewYear).map((month, index) => {
            const enabled = availableSet.has(month);
            const on = selectedMonths.includes(month);
            return (
              <button
                key={month}
                type="button"
                disabled={!enabled}
                aria-pressed={on}
                onClick={() => toggleMonth(month)}
                onDoubleClick={() => selectOnly(month)}
                className={`min-h-11 touch-manipulation rounded-xl px-2 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-30 ${
                  on
                    ? "bg-coral-500 text-sand-50"
                    : "border border-ink-900/10 bg-sand-50 text-ink-700 hover:border-ink-900/20"
                }`}
              >
                {SHORT_MONTHS[index]}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] font-semibold text-ink-500">
          Tap to select months. Double-tap a month to select only that one.
        </p>
        {selectedMonths.length > 0 ? (
          <button
            type="button"
            onClick={() => setSelectedMonths([])}
            className="mt-2 text-xs font-bold text-ink-600 underline-offset-2 hover:underline"
          >
            Clear selection
          </button>
        ) : null}
      </div>

      <div
        role="group"
        aria-label="Show spending, income, or both"
        className="grid grid-cols-3 gap-2"
      >
        {(
          [
            ["spending", "Spending"],
            ["income", "Income"],
            ["both", "Both"],
          ] as const
        ).map(([mode, label]) => {
          const on = viewMode === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={on}
              onClick={() => setViewMode(mode)}
              className={`min-h-11 touch-manipulation rounded-xl px-3 py-2 text-xs font-bold transition ${
                on
                  ? "bg-ink-900 text-sand-50"
                  : "border border-ink-900/10 bg-sand-50 text-ink-700 hover:border-ink-900/20"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        className={
          viewMode === "both" ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : undefined
        }
      >
        {showSpending ? (
          <FlowBreakdownCard
            title="Spending by category"
            emptyLabel="No spending in the selected months."
            colors={SPENDING_COLORS}
            breakdown={spending}
            accountIds={accountIds}
            selectedMonths={selectedMonths}
            compact={viewMode === "both"}
            onOpen={(categoryId, name) =>
              setDrilldown({ categoryId, name, flow: "spending" })
            }
          />
        ) : null}
        {showIncome ? (
          <FlowBreakdownCard
            title="Income by category"
            emptyLabel="No income in the selected months."
            colors={INCOME_COLORS}
            breakdown={income}
            accountIds={accountIds}
            selectedMonths={selectedMonths}
            compact={viewMode === "both"}
            onOpen={(categoryId, name) =>
              setDrilldown({ categoryId, name, flow: "income" })
            }
          />
        ) : null}
      </div>

      {drilldown ? (
        <CategoryTransactionsBanner
          dataset={dataset}
          selectedMonths={selectedMonths}
          accountIds={accountIds}
          categoryId={drilldown.categoryId}
          categoryName={drilldown.name}
          flow={drilldown.flow}
          onClose={() => setDrilldown(null)}
        />
      ) : null}
    </div>
  );
}

function FlowBreakdownCard({
  title,
  emptyLabel,
  colors,
  breakdown,
  accountIds,
  selectedMonths,
  compact,
  onOpen,
}: {
  title: string;
  emptyLabel: string;
  colors: readonly string[];
  breakdown: ReturnType<typeof deriveCategoryBreakdown>;
  accountIds: string[];
  selectedMonths: string[];
  compact: boolean;
  onOpen: (categoryId: string | null, name: string) => void;
}) {
  const chartData = useMemo(
    () =>
      breakdown.rows.slice(0, 8).map((row, index) => ({
        key: row.categoryId ?? `uncat-${index}`,
        name: row.name,
        value: row.cents / 100,
        cents: row.cents,
        color: colors[index % colors.length]!,
        categoryId: row.categoryId,
      })),
    [breakdown.rows, colors],
  );

  return (
    <div className="card-surface rounded-2xl p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-ink-900">{title}</h3>
        <p className="text-sm font-bold text-ink-800">
          {formatCents(breakdown.totalCents)}
        </p>
      </div>

      {!accountIds.length ? (
        <p className="py-8 text-center text-sm text-ink-600">
          Select at least one account to see the breakdown.
        </p>
      ) : !selectedMonths.length ? (
        <p className="py-8 text-center text-sm text-ink-600">
          Select one or more months to see the breakdown.
        </p>
      ) : !breakdown.rows.length ? (
        <p className="py-8 text-center text-sm text-ink-600">{emptyLabel}</p>
      ) : (
        <>
          <div
            className={`mx-auto w-full max-w-sm ${compact ? "h-44" : "h-56"}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="48%"
                  outerRadius="78%"
                  paddingAngle={2}
                  stroke="none"
                  className="cursor-pointer outline-none"
                  onClick={(_, index) => {
                    const entry = chartData[index];
                    if (!entry) return;
                    onOpen(entry.categoryId, entry.name);
                  }}
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) =>
                    formatCents(Math.round(Number(value ?? 0) * 100))
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul className="mt-2 space-y-1.5">
            {breakdown.rows.map((row, index) => (
              <CategoryRow
                key={row.categoryId ?? `uncat-${row.name}`}
                row={row}
                color={colors[index % colors.length]!}
                onOpen={() => onOpen(row.categoryId, row.name)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CategoryRow({
  row,
  color,
  onOpen,
}: {
  row: CategorySpendRow;
  color: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full touch-manipulation items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-ink-900/5"
      >
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink-900">{row.name}</span>
          <span className="block text-[11px] font-semibold text-ink-500">
            {row.groupName} · {row.share.toFixed(0)}%
          </span>
        </span>
        <span className="shrink-0 text-sm font-bold text-ink-800">
          {formatCents(row.cents)}
        </span>
      </button>
    </li>
  );
}

function CategoryTransactionsBanner({
  dataset,
  selectedMonths,
  accountIds,
  categoryId,
  categoryName,
  flow,
  onClose,
}: {
  dataset: InsightsDataset;
  selectedMonths: string[];
  accountIds: string[];
  categoryId: string | null;
  categoryName: string;
  flow: FlowKind;
  onClose: () => void;
}) {
  const titleId = useId();
  const txns = useMemo(
    () =>
      deriveCategoryTransactions(
        dataset,
        selectedMonths,
        categoryId,
        accountIds,
        flow,
      ),
    [dataset, selectedMonths, categoryId, accountIds, flow],
  );
  const total = txns.reduce((sum, t) => sum + Math.abs(t.amountCents), 0);
  const periodLabel =
    selectedMonths.length === 1
      ? formatBudgetMonth(selectedMonths[0]!)
      : selectedMonths.length === 0
        ? "no months"
        : `${selectedMonths.length} months`;
  const amountClass =
    flow === "income" ? "text-moss-700 dark:text-moss-300" : "text-coral-600";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink-900/45 p-3 backdrop-blur-[2px] sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close category transactions"
        className="absolute inset-0"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(85vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-sand-50 shadow-xl ring-1 ring-ink-900/10 animate-rise"
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-900/10 px-4 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="font-display text-xl font-bold text-ink-900"
            >
              {categoryName}
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              {txns.length} {txns.length === 1 ? "transaction" : "transactions"} ·{" "}
              {formatCents(total)} · {periodLabel} ·{" "}
              {flow === "income" ? "income" : "spending"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-xl px-2 py-1 text-sm font-bold text-ink-600 hover:bg-ink-900/5"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!txns.length ? (
            <p className="py-8 text-center text-sm text-ink-600">
              No transactions in this category for the selected months.
            </p>
          ) : (
            <ul className="divide-y divide-ink-900/5">
              {txns.map((txn, index) => (
                <li
                  key={`${txn.occurredOn}-${txn.payee}-${txn.amountCents}-${index}`}
                  className="flex items-start justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">
                      {txn.payee || "Unknown"}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-ink-500">
                      {formatBudgetDate(txn.occurredOn)} · {txn.accountName}
                    </p>
                  </div>
                  <p className={`shrink-0 text-sm font-bold ${amountClass}`}>
                    {formatCents(Math.abs(txn.amountCents))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

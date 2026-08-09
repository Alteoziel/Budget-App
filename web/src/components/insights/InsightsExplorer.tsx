"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CollapsibleInsight } from "@/components/insights/CollapsibleInsight";
import { InsightsCharts } from "@/components/insights/InsightsCharts";
import { MonthSpendingBreakdown } from "@/components/insights/MonthSpendingBreakdown";
import type { InsightsDataset } from "@/lib/insights/dataset";
import { deriveInsights } from "@/lib/insights/derive";
import { tipsFromFindings } from "@/lib/insights/tips";

const MONTH_OPTIONS = [6, 12, 18, 24];

export function InsightsExplorer({ dataset }: { dataset: InsightsDataset }) {
  const [monthsBack, setMonthsBack] = useState(12);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const { points, findings } = useMemo(
    () => deriveInsights(dataset, { monthsBack, accountIds, categoryIds }),
    [dataset, monthsBack, accountIds, categoryIds],
  );
  const tips = useMemo(() => tipsFromFindings(findings), [findings]);

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  const filtersActive =
    monthsBack !== 12 || accountIds.length > 0 || categoryIds.length > 0;

  return (
    <>
      <CollapsibleInsight
        title="Month spending"
        description="Pick months on the calendar to see spending by category. Tap a category for its transactions."
        defaultOpen
      >
        <MonthSpendingBreakdown dataset={dataset} accountIds={accountIds} />
      </CollapsibleInsight>

      <CollapsibleInsight
        title="Filters"
        description="Narrow the charts, trends, and tips below."
      >
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-3">
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  setMonthsBack(12);
                  setAccountIds([]);
                  setCategoryIds([]);
                }}
                className="min-h-9 rounded-xl border border-ink-900/15 bg-sand-50 px-3 py-1.5 text-xs font-bold text-ink-700"
              >
                Reset
              </button>
            ) : null}
          </div>

          <FilterGroup
            label="Time range"
            tone="time"
            hint="How far back charts look"
          >
            {MONTH_OPTIONS.map((n) => {
              const on = monthsBack === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMonthsBack(n)}
                  aria-pressed={on}
                  className={chipClass("time", on)}
                >
                  {n} mo
                </button>
              );
            })}
          </FilterGroup>

          {dataset.accounts.length ? (
            <FilterGroup
              label="Accounts"
              tone="accounts"
              hint={
                accountIds.length
                  ? `${accountIds.length} selected`
                  : "All accounts"
              }
            >
              {dataset.accounts.map((account) => {
                const on = accountIds.includes(account.id);
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() =>
                      setAccountIds((prev) => toggle(prev, account.id))
                    }
                    aria-pressed={on}
                    className={chipClass("accounts", on)}
                  >
                    {account.name}
                  </button>
                );
              })}
            </FilterGroup>
          ) : null}

          {dataset.categories.length ? (
            <FilterGroup
              label="Categories"
              tone="categories"
              hint={
                categoryIds.length
                  ? `${categoryIds.length} selected`
                  : "All categories"
              }
              scrollable
            >
              {dataset.categories.map((category) => {
                const on = categoryIds.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() =>
                      setCategoryIds((prev) => toggle(prev, category.id))
                    }
                    aria-pressed={on}
                    className={chipClass("categories", on)}
                  >
                    {category.name}
                  </button>
                );
              })}
            </FilterGroup>
          ) : null}
        </div>
      </CollapsibleInsight>

      <CollapsibleInsight
        title="Charts"
        description="Spending, income, and balance over the filtered range."
      >
        <InsightsCharts points={points} />
      </CollapsibleInsight>

      <CollapsibleInsight
        title="Trends"
        description="Signals pulled from your filtered history."
      >
        {!findings.length ? (
          <p className="text-sm text-ink-600">
            Not enough history for trend signals yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f) => (
              <li key={f.id} className="card-surface rounded-2xl px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900">{f.title}</p>
                  <SeverityBadge severity={f.severity} />
                </div>
                <p className="mt-1 text-sm text-ink-600">{f.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleInsight>

      <CollapsibleInsight
        title="Tips for you"
        description="Actionable next steps based on your trends — not the same cards again."
      >
        {!tips.length ? (
          <p className="text-sm text-ink-600">
            Tips show up once there is enough history for a clear recommendation.
          </p>
        ) : (
          <ul className="space-y-2">
            {tips.map((tip) => (
              <li
                key={tip.id}
                className="rounded-3xl bg-moss-500/10 px-4 py-3 shadow-soft"
              >
                <p className="text-sm font-semibold text-ink-900">
                  {tip.headline}
                </p>
                <p className="mt-1 text-sm text-ink-600">{tip.body}</p>
                {tip.actions.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tip.actions.map((a) =>
                      a.href ? (
                        <Link
                          key={a.href + a.label}
                          href={a.href}
                          className="rounded-lg bg-moss-500 px-2.5 py-1 text-xs font-bold text-sand-50"
                        >
                          {a.label}
                        </Link>
                      ) : null,
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleInsight>
    </>
  );
}

type FilterTone = "time" | "accounts" | "categories";

const GROUP_TONES: Record<FilterTone, { shell: string; label: string }> = {
  time: {
    shell: "border-ink-900/15 bg-ink-900/[0.04] dark:bg-ink-900/10",
    label: "text-ink-700",
  },
  accounts: {
    shell: "border-moss-500/30 bg-moss-500/10",
    label: "text-moss-700 dark:text-moss-300",
  },
  categories: {
    shell: "border-coral-500/30 bg-coral-500/10",
    label: "text-coral-700 dark:text-coral-300",
  },
};

function chipClass(tone: FilterTone, on: boolean): string {
  const base =
    "min-h-11 touch-manipulation rounded-xl px-3 py-1.5 text-xs font-bold transition";
  if (tone === "time") {
    return `${base} ${
      on
        ? "bg-ink-900 text-sand-50"
        : "border border-ink-900/10 bg-sand-50 text-ink-700 hover:border-ink-900/20"
    }`;
  }
  if (tone === "accounts") {
    return `${base} ${
      on
        ? "bg-moss-500 text-sand-50"
        : "border border-moss-500/25 bg-sand-50 text-moss-800 hover:border-moss-500/40 dark:text-moss-200"
    }`;
  }
  return `${base} ${
    on
      ? "bg-coral-500 text-sand-50"
      : "border border-coral-500/25 bg-sand-50 text-coral-800 hover:border-coral-500/40 dark:text-coral-200"
  }`;
}

function FilterGroup({
  label,
  tone,
  hint,
  scrollable = false,
  children,
}: {
  label: string;
  tone: FilterTone;
  hint?: string;
  scrollable?: boolean;
  children: React.ReactNode;
}) {
  const tones = GROUP_TONES[tone];
  return (
    <section className={`rounded-2xl border px-3 py-3 ${tones.shell}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3
          className={`text-[11px] font-bold uppercase tracking-[0.14em] ${tones.label}`}
        >
          {label}
        </h3>
        {hint ? (
          <p className="text-[11px] font-semibold text-ink-500">{hint}</p>
        ) : null}
      </div>
      <div
        className={`flex flex-wrap gap-2 ${
          scrollable ? "max-h-28 overflow-y-auto pr-0.5" : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}

function SeverityBadge({ severity }: { severity: "info" | "watch" | "alert" }) {
  const styles =
    severity === "alert"
      ? "bg-coral-400/20 text-coral-500"
      : severity === "watch"
        ? "bg-amber-100 text-amber-900"
        : "bg-sand-100 text-ink-600";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${styles}`}
    >
      {severity}
    </span>
  );
}

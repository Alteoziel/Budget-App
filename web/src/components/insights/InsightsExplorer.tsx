"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { InsightsCharts } from "@/components/insights/InsightsCharts";
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
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {MONTH_OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setMonthsBack(n)}
            className={`min-h-11 rounded-xl px-3 py-1.5 font-bold ${
              monthsBack === n ? "bg-ink-900 text-sand-50" : "bg-sand-100 text-ink-600"
            }`}
          >
            {n} mo
          </button>
        ))}
        {filtersActive ? (
          <button
            type="button"
            onClick={() => {
              setMonthsBack(12);
              setAccountIds([]);
              setCategoryIds([]);
            }}
            className="min-h-11 rounded-xl border border-ink-900/10 px-3 py-1.5 font-bold text-ink-600"
          >
            Reset
          </button>
        ) : null}
      </div>

      {dataset.accounts.length ? (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {dataset.accounts.map((account) => {
            const on = accountIds.includes(account.id);
            return (
              <button
                key={account.id}
                type="button"
                onClick={() => setAccountIds((prev) => toggle(prev, account.id))}
                aria-pressed={on}
                className={`min-h-11 rounded-xl px-3 py-1.5 font-semibold ${
                  on ? "bg-moss-500 text-sand-50" : "bg-sand-100 text-ink-600"
                }`}
              >
                {account.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {dataset.categories.length ? (
        <div className="mb-6 flex max-h-28 flex-wrap gap-2 overflow-y-auto text-xs">
          {dataset.categories.map((category) => {
            const on = categoryIds.includes(category.id);
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryIds((prev) => toggle(prev, category.id))}
                aria-pressed={on}
                className={`min-h-11 rounded-xl px-3 py-1.5 font-semibold ${
                  on ? "bg-ink-900 text-sand-50" : "bg-sand-100 text-ink-600"
                }`}
              >
                {category.name}
              </button>
            );
          })}
        </div>
      ) : null}

      <InsightsCharts points={points} />

      <section className="mt-6 space-y-3">
        <h2 className="font-display text-lg font-bold text-ink-900">Trends</h2>
        {!findings.length ? (
          <p className="text-sm text-ink-600">Not enough history for trend signals yet.</p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f) => (
              <li key={f.id} className="rounded-3xl bg-sand-50/80 px-4 py-3 shadow-soft">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900">{f.title}</p>
                  <SeverityBadge severity={f.severity} />
                </div>
                <p className="mt-1 text-sm text-ink-600">{f.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 space-y-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink-900">Tips for you</h2>
          <p className="mt-1 text-sm text-ink-600">
            Actionable next steps based on your trends — not the same cards again.
          </p>
        </div>
        {!tips.length ? (
          <p className="text-sm text-ink-600">
            Tips show up once there is enough history for a clear recommendation.
          </p>
        ) : (
          <ul className="space-y-2">
            {tips.map((tip) => (
              <li key={tip.id} className="rounded-3xl bg-moss-500/10 px-4 py-3 shadow-soft">
                <p className="text-sm font-semibold text-ink-900">{tip.headline}</p>
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
      </section>
    </>
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
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${styles}`}>
      {severity}
    </span>
  );
}

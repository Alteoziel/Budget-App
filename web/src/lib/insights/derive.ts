import type { InsightsDataset } from "@/lib/insights/dataset";
import type { MonthPoint } from "@/lib/insights/series";
import type { TrendFinding } from "@/lib/types";

export type DerivedFilters = {
  monthsBack: number;
  accountIds: string[];
  categoryIds: string[];
};

export type DerivedInsights = {
  points: MonthPoint[];
  findings: TrendFinding[];
};

function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Recompute the whole Insights view from the cached dataset, in memory. */
export function deriveInsights(
  dataset: InsightsDataset,
  filters: DerivedFilters,
): DerivedInsights {
  const monthsBack = Math.min(
    Math.max(filters.monthsBack, 3),
    dataset.months.length,
  );
  const firstIndex = dataset.months.length - monthsBack;
  const months = dataset.months.slice(firstIndex);

  const accountSet = new Set(filters.accountIds);
  const categorySet = new Set(filters.categoryIds);

  const accountAllowed = dataset.accounts.map(
    (account) => accountSet.size === 0 || accountSet.has(account.id),
  );
  const categoryAllowed = dataset.categories.map(
    (category) => categorySet.size === 0 || categorySet.has(category.id),
  );

  const spending = new Array<number>(monthsBack).fill(0);
  const income = new Array<number>(monthsBack).fill(0);
  const delta = new Array<number>(monthsBack).fill(0);
  const categoryTotals = new Map<string, { name: string; cents: number }>();

  for (const [mi, ai, ci, amount] of dataset.cells) {
    if (!accountAllowed[ai]) continue;
    const localMonth = mi - firstIndex;
    if (localMonth < 0) continue;

    delta[localMonth]! += amount;

    if (ci >= 0 && amount < 0) {
      const category = dataset.categories[ci]!;
      const entry = categoryTotals.get(category.id) ?? {
        name: category.name,
        cents: 0,
      };
      entry.cents += Math.abs(amount);
      categoryTotals.set(category.id, entry);
    }

    if (categorySet.size > 0 && (ci < 0 || !categoryAllowed[ci])) continue;
    if (amount < 0) spending[localMonth]! += Math.abs(amount);
    else income[localMonth]! += amount;
  }

  // Balance carried in: everything before the window, plus filtered months we skipped.
  let running = 0;
  dataset.priorByAccount.forEach((cents, ai) => {
    if (accountAllowed[ai]) running += cents;
  });
  for (const [mi, ai, , amount] of dataset.cells) {
    if (!accountAllowed[ai]) continue;
    if (mi < firstIndex) running += amount;
  }

  const points: MonthPoint[] = months.map((month, i) => {
    running += delta[i] ?? 0;
    return {
      month,
      spendingCents: spending[i] ?? 0,
      incomeCents: income[i] ?? 0,
      endBalanceCents: running,
    };
  });

  const findings = deriveTrendFindings({
    points,
    dataset,
    firstIndex,
    categoryTotals,
  });

  return { points, findings };
}

function deriveTrendFindings({
  points,
  dataset,
  firstIndex,
  categoryTotals,
}: {
  points: MonthPoint[];
  dataset: InsightsDataset;
  firstIndex: number;
  categoryTotals: Map<string, { name: string; cents: number }>;
}): TrendFinding[] {
  const now = new Date().toISOString();
  const findings: TrendFinding[] = [];

  if (points.length >= 2) {
    const last = points[points.length - 1]!;
    const prev = points[points.length - 2]!;

    const spendChange = pctChange(last.spendingCents, prev.spendingCents);
    if (spendChange != null && Math.abs(spendChange) >= 25) {
      findings.push({
        id: "spend-mom",
        kind: "spending_mom",
        severity: spendChange > 0 ? "alert" : "info",
        title:
          spendChange > 0 ? "Spending jumped last month" : "Spending dropped last month",
        summary: `Spending moved ${spendChange > 0 ? "+" : ""}${spendChange.toFixed(0)}% vs the prior month.`,
        metrics: {
          currentCents: last.spendingCents,
          priorCents: prev.spendingCents,
          pct: Number(spendChange.toFixed(1)),
        },
        relatedIds: [],
        createdAt: now,
      });
    }

    const trailing = points.slice(0, -1).map((p) => p.spendingCents);
    const baseline = avg(trailing);
    if (baseline > 0 && last.spendingCents > baseline * 1.35) {
      findings.push({
        id: "spend-spike",
        kind: "spending_spike",
        severity: "watch",
        title: "Spending spike vs your average",
        summary: `Latest month is ${(((last.spendingCents - baseline) / baseline) * 100).toFixed(0)}% above your trailing average.`,
        metrics: {
          currentCents: last.spendingCents,
          averageCents: Math.round(baseline),
        },
        relatedIds: [],
        createdAt: now,
      });
    }

    const windowPts = points.slice(-6);
    const incomeSum = windowPts.reduce((s, p) => s + p.incomeCents, 0);
    const spendSum = windowPts.reduce((s, p) => s + p.spendingCents, 0);
    if (incomeSum > 0) {
      const savingsRate = ((incomeSum - spendSum) / incomeSum) * 100;
      findings.push({
        id: "savings-rate",
        kind: "savings_rate",
        severity: savingsRate < 5 ? "alert" : savingsRate < 15 ? "watch" : "info",
        title: `Savings rate ${savingsRate.toFixed(0)}% (last ${windowPts.length} months)`,
        summary:
          savingsRate >= 15
            ? "You are consistently keeping a healthy share of income."
            : "A larger gap between income and spending would accelerate goals.",
        metrics: {
          savingsRate: Number(savingsRate.toFixed(1)),
          incomeCents: incomeSum,
          spendingCents: spendSum,
        },
        relatedIds: [],
        createdAt: now,
      });
    }

    const incomes = windowPts.map((p) => p.incomeCents);
    const incomeAvg = avg(incomes);
    if (incomeAvg > 0) {
      const variance =
        incomes.reduce((s, v) => s + (v - incomeAvg) ** 2, 0) / incomes.length;
      const cv = Math.sqrt(variance) / incomeAvg;
      if (cv > 0.35) {
        findings.push({
          id: "income-volatility",
          kind: "income_volatility",
          severity: "watch",
          title: "Income is uneven month to month",
          summary:
            "Build a buffer month so essential categories stay funded when income dips.",
          metrics: { coefficientOfVariation: Number(cv.toFixed(2)) },
          relatedIds: [],
          createdAt: now,
        });
      }
    }
  }

  const byPayee = new Map<number, number[]>();
  for (const [mi, pi, cents] of dataset.payeeCells) {
    if (mi < firstIndex) continue;
    const list = byPayee.get(pi) ?? [];
    list.push(cents);
    byPayee.set(pi, list);
  }

  for (const [pi, amounts] of byPayee) {
    if (amounts.length < 3) continue;
    const mean = avg(amounts);
    if (mean < 500) continue;
    const within = amounts.every((a) => Math.abs(a - mean) / mean <= 0.15);
    if (!within) continue;
    const payee = dataset.payees[pi] ?? "";
    if (!payee) continue;
    findings.push({
      id: `recurring-${payee.slice(0, 24)}`,
      kind: "recurring_outflow",
      severity: "info",
      title: `Recurring: ${payee}`,
      summary: `About ${(mean / 100).toFixed(2)} shows up in ${amounts.length} months — confirm it still earns its place.`,
      metrics: { averageCents: Math.round(mean), months: amounts.length },
      relatedIds: [],
      createdAt: now,
    });
  }

  const ranked = [...categoryTotals.entries()].sort((a, b) => b[1].cents - a[1].cents);
  const totalSpend = ranked.reduce((s, [, v]) => s + v.cents, 0);
  if (totalSpend > 0 && ranked[0]) {
    const [id, top] = ranked[0];
    const share = (top.cents / totalSpend) * 100;
    if (share >= 20) {
      findings.push({
        id: "top-category",
        kind: "value_focus",
        severity: "info",
        title: `${top.name} is ${share.toFixed(0)}% of spending`,
        summary:
          "If this matches what you value, great — protect it. If not, trim here first.",
        metrics: { share: Number(share.toFixed(1)), cents: top.cents },
        relatedIds: [id],
        createdAt: now,
      });
    }
  }

  return findings;
}

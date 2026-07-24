import type { MonthPoint, InsightsFilters } from "@/lib/insights/series";
import { getInsightSeries } from "@/lib/insights/series";
import { requireBudget } from "@/lib/budget-context";
import type { TrendFinding } from "@/lib/types";

function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function computeTrendFindings(
  filters: InsightsFilters = {},
): Promise<TrendFinding[]> {
  const { points } = await getInsightSeries(filters);
  const { supabase, budget } = await requireBudget("viewer");
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
        title: spendChange > 0 ? "Spending jumped last month" : "Spending dropped last month",
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

  // Recurring-looking outflows by payee
  const lookbackStart = points[0] ? `${points[0].month}-01` : "2000-01-01";
  const { data: txns } = await supabase
    .from("transactions")
    .select("payee,amount_cents,occurred_on")
    .eq("budget_id", budget.id)
    .lt("amount_cents", 0)
    .gte("occurred_on", lookbackStart)
    .neq("payee", "");

  const byPayee = new Map<string, Array<{ month: string; cents: number }>>();
  for (const txn of txns ?? []) {
    const payee = String(txn.payee).trim().toLowerCase();
    if (!payee) continue;
    const month = String(txn.occurred_on).slice(0, 7);
    const cents = Math.abs(txn.amount_cents as number);
    const list = byPayee.get(payee) ?? [];
    const existing = list.find((x) => x.month === month);
    if (existing) existing.cents += cents;
    else list.push({ month, cents });
    byPayee.set(payee, list);
  }

  for (const [payee, months] of byPayee) {
    if (months.length < 3) continue;
    const amounts = months.map((m) => m.cents);
    const mean = avg(amounts);
    if (mean < 500) continue; // ignore tiny
    const within = amounts.every((a) => Math.abs(a - mean) / mean <= 0.15);
    if (!within) continue;
    findings.push({
      id: `recurring-${payee.slice(0, 24)}`,
      kind: "recurring_outflow",
      severity: "info",
      title: `Recurring: ${payee}`,
      summary: `About ${(mean / 100).toFixed(2)} shows up in ${months.length} months — confirm it still earns its place.`,
      metrics: { averageCents: Math.round(mean), months: months.length },
      relatedIds: [],
      createdAt: now,
    });
  }

  // Top discretionary share (uncategorized ignored; use largest spend categories)
  const { data: catTxns } = await supabase
    .from("transactions")
    .select("category_id,amount_cents,categories(name)")
    .eq("budget_id", budget.id)
    .lt("amount_cents", 0)
    .gte("occurred_on", lookbackStart)
    .not("category_id", "is", null);

  const catTotals = new Map<string, { name: string; cents: number }>();
  for (const row of catTxns ?? []) {
    const id = row.category_id as string;
    const cat = row.categories as unknown as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(cat) ? cat[0]?.name : cat?.name;
    const entry = catTotals.get(id) ?? { name: name || id, cents: 0 };
    entry.cents += Math.abs(row.amount_cents as number);
    catTotals.set(id, entry);
  }
  const ranked = [...catTotals.entries()].sort((a, b) => b[1].cents - a[1].cents);
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

export type { MonthPoint };

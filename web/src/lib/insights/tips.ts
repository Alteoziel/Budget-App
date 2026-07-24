import { formatCents } from "@/lib/money";
import type { TipCard, TrendFinding } from "@/lib/types";

const SEVERITY_RANK: Record<TrendFinding["severity"], number> = {
  alert: 0,
  watch: 1,
  info: 2,
};

/** Turn observational trends into short, actionable tip cards. */
export function tipsFromFindings(findings: TrendFinding[]): TipCard[] {
  const ranked = [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );

  const tips: TipCard[] = [];
  for (const finding of ranked) {
    const tip = findingToTip(finding);
    if (!tip) continue;
    tips.push(tip);
    if (tips.length >= 4) break;
  }
  return tips;
}

function money(cents: unknown): string | null {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
  return formatCents(cents);
}

function findingToTip(finding: TrendFinding): TipCard | null {
  const m = finding.metrics;

  switch (finding.kind) {
    case "spending_mom": {
      const up = Number(m.pct) > 0;
      return {
        id: `tip-${finding.id}`,
        findingId: finding.id,
        headline: up ? "Reclaim last month’s overspend" : "Lock in last month’s win",
        body: up
          ? `Spending rose ${Number(m.pct).toFixed(0)}%. Open the budget and trim the categories that grew before this month fills up.`
          : `Spending fell ${Math.abs(Number(m.pct)).toFixed(0)}%. Assign the leftover Ready to Assign so it doesn’t get spent by accident.`,
        actions: [
          { label: "Open budget", href: "/budget" },
          { label: "Review accounts", href: "/accounts" },
        ],
        llmVersion: null,
      };
    }
    case "spending_spike": {
      const current = money(m.currentCents);
      const average = money(m.averageCents);
      return {
        id: `tip-${finding.id}`,
        findingId: finding.id,
        headline: "Pause before another high-spend week",
        body:
          current && average
            ? `This month is at ${current} vs your usual ${average}. Sweep recent outflows and move leftovers into a buffer category.`
            : "This month is running hot versus your average. Sweep recent outflows and park leftovers in a buffer category.",
        actions: [
          { label: "Scan accounts", href: "/accounts" },
          { label: "Adjust budget", href: "/budget" },
        ],
        llmVersion: null,
      };
    }
    case "savings_rate": {
      const rate = Number(m.savingsRate);
      if (!Number.isFinite(rate)) return null;
      if (rate >= 15) {
        return {
          id: `tip-${finding.id}`,
          findingId: finding.id,
          headline: "Protect your savings streak",
          body: `You’re keeping about ${rate.toFixed(0)}% of income. Auto-assign a slice of Ready to Assign into savings so the habit stays on rails.`,
          actions: [{ label: "Auto-assign", href: "/budget" }],
          llmVersion: null,
        };
      }
      return {
        id: `tip-${finding.id}`,
        findingId: finding.id,
        headline: "Aim for a 15% savings gap",
        body: `Current savings rate is ${rate.toFixed(0)}%. Pick one category to cut 5–10% this month, then assign the difference before it disappears.`,
        actions: [
          { label: "Open budget", href: "/budget" },
          { label: "See trends", href: "/insights" },
        ],
        llmVersion: null,
      };
    }
    case "income_volatility":
      return {
        id: `tip-${finding.id}`,
        findingId: finding.id,
        headline: "Fund a one-month buffer",
        body: "Income swings month to month. Build a holding category equal to one month of essentials so bills stay covered on lean months.",
        actions: [{ label: "Set up buffer", href: "/budget" }],
        llmVersion: null,
      };
    case "recurring_outflow": {
      const avg = money(m.averageCents);
      const label = finding.title.replace(/^Recurring:\s*/i, "").trim() || "this charge";
      return {
        id: `tip-${finding.id}`,
        findingId: finding.id,
        headline: `Decide if ${label} still earns its spot`,
        body: avg
          ? `About ${avg} hits most months. Confirm it’s worth keeping, cancel it, or give it a dedicated category so it stops surprising you.`
          : "This looks like a recurring charge. Confirm it’s worth keeping, cancel it, or give it a dedicated category.",
        actions: [
          { label: "Find in accounts", href: "/accounts" },
          { label: "Categorize", href: "/budget" },
        ],
        llmVersion: null,
      };
    }
    case "value_focus": {
      const share = Number(m.share);
      const name = finding.title.split(" is ")[0] || "This category";
      return {
        id: `tip-${finding.id}`,
        findingId: finding.id,
        headline: `Make a call on ${name}`,
        body: Number.isFinite(share)
          ? `It’s ${share.toFixed(0)}% of spending. If it matches your priorities, protect the assignment; if not, cut here first and move money to goals.`
          : "This category takes a large share of spending. Protect it if it matches your priorities, or cut here first.",
        actions: [{ label: "Review budget", href: "/budget" }],
        llmVersion: null,
      };
    }
    default:
      return null;
  }
}

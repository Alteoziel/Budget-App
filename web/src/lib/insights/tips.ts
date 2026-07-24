import type { TipCard, TrendFinding } from "@/lib/types";

/** Map deterministic findings → tip cards (template strings; LLM can rewrite later). */
export function tipsFromFindings(findings: TrendFinding[]): TipCard[] {
  return findings.map((finding) => findingToTip(finding));
}

function findingToTip(finding: TrendFinding): TipCard {
  const actions: TipCard["actions"] = [];

  switch (finding.kind) {
    case "spending_mom":
    case "value_focus":
      actions.push({ label: "Review budget", href: "/budget" });
      break;
    case "spending_spike":
    case "recurring_outflow":
      actions.push({ label: "Open register", href: "/accounts" });
      break;
    case "savings_rate":
    case "income_volatility":
      actions.push({ label: "Plan next month", href: "/budget" });
      break;
    default:
      actions.push({ label: "Open insights", href: "/insights" });
      break;
  }

  return {
    id: `tip-${finding.id}`,
    findingId: finding.id,
    headline: finding.title,
    body: finding.summary,
    actions,
    // Reserved for a future LLM rewriter of headline/body only.
    llmVersion: null,
  };
}

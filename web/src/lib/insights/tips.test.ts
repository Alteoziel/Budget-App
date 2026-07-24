import assert from "node:assert/strict";
import { tipsFromFindings } from "@/lib/insights/tips";
import type { TrendFinding } from "@/lib/types";

const finding: TrendFinding = {
  id: "spend-mom",
  kind: "spending_mom",
  severity: "alert",
  title: "Spending jumped last month",
  summary: "Spending moved +40% vs the prior month.",
  metrics: { pct: 40 },
  relatedIds: [],
  createdAt: new Date().toISOString(),
};

const tips = tipsFromFindings([finding]);
assert.equal(tips.length, 1);
assert.equal(tips[0]!.findingId, "spend-mom");
assert.equal(tips[0]!.headline, finding.title);
assert.equal(tips[0]!.body, finding.summary);
assert.equal(tips[0]!.llmVersion, null);
assert.ok(tips[0]!.actions.some((a) => a.href === "/budget"));

console.log("tips.test.ts: ok");

import assert from "node:assert/strict";
import { tipsFromFindings } from "@/lib/insights/tips";
import type { TrendFinding } from "@/lib/types";

const finding: TrendFinding = {
  id: "spend-mom",
  kind: "spending_mom",
  severity: "alert",
  title: "Spending jumped last month",
  summary: "Spending moved +40% vs the prior month.",
  metrics: { pct: 40, currentCents: 140000, priorCents: 100000 },
  relatedIds: [],
  createdAt: new Date().toISOString(),
};

const tips = tipsFromFindings([finding]);
assert.equal(tips.length, 1);
assert.equal(tips[0]!.findingId, "spend-mom");
assert.notEqual(tips[0]!.headline, finding.title);
assert.notEqual(tips[0]!.body, finding.summary);
assert.match(tips[0]!.headline, /overspend|win|Reclaim|Lock/i);
assert.equal(tips[0]!.llmVersion, null);
assert.ok(tips[0]!.actions.some((a) => a.href === "/budget"));

const infoOnly: TrendFinding = {
  id: "top-category",
  kind: "value_focus",
  severity: "info",
  title: "Dining is 30% of spending",
  summary: "If this matches what you value, great.",
  metrics: { share: 30, cents: 30000 },
  relatedIds: ["cat-1"],
  createdAt: new Date().toISOString(),
};
const infoTips = tipsFromFindings([infoOnly]);
assert.equal(infoTips.length, 1);
assert.match(infoTips[0]!.headline, /Dining|call/i);
assert.notEqual(infoTips[0]!.body, infoOnly.summary);

console.log("tips.test.ts: ok");

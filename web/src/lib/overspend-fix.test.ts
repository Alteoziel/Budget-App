import assert from "node:assert/strict";
import {
  allocateDonations,
  groupAllocationsByTarget,
  overspendDonorSoftnessScore,
  rankOverspendDonors,
  totalDonatedCents,
  totalShortfallCents,
  validateOverspendTransferPlan,
  type OverspendDonorCandidate,
} from "@/lib/overspend-fix";

const targets = [
  { categoryId: "dining", categoryName: "Dining", shortfallCents: 3000 },
  { categoryId: "gas", categoryName: "Gas", shortfallCents: 1500 },
];

assert.equal(totalShortfallCents(targets), 4500);

const donations = [
  { categoryId: "groceries", categoryName: "Groceries", cents: 2000 },
  { categoryId: "fun", categoryName: "Fun", cents: 3000 },
];
assert.equal(totalDonatedCents(donations), 5000);

const { allocations, remainingCents, leftoverCents } = allocateDonations(
  targets,
  donations,
);

assert.equal(remainingCents, 0);
assert.equal(leftoverCents, 500);
assert.equal(
  allocations.reduce((sum, a) => sum + a.cents, 0),
  4500,
);
assert.deepEqual(
  allocations.map((a) => [a.fromCategoryId, a.toCategoryId, a.cents]),
  [
    ["groceries", "dining", 2000],
    ["fun", "dining", 1000],
    ["fun", "gas", 1500],
  ],
);

const byTarget = groupAllocationsByTarget(allocations);
assert.equal(byTarget.get("dining")!.length, 2);
assert.equal(byTarget.get("gas")!.length, 1);

// Underfunded case reports what is still missing.
const short = allocateDonations(targets, [
  { categoryId: "fun", categoryName: "Fun", cents: 1000 },
]);
assert.equal(short.remainingCents, 3500);
assert.equal(short.leftoverCents, 0);

// A category never funds itself.
const selfFund = allocateDonations(
  [{ categoryId: "dining", categoryName: "Dining", shortfallCents: 1000 }],
  [{ categoryId: "dining", categoryName: "Dining", cents: 1000 }],
);
assert.equal(selfFund.allocations.length, 0);
assert.equal(selfFund.remainingCents, 1000);

const duplicateDonorPlan = validateOverspendTransferPlan(
  [
    { categoryId: "fun", cents: 600 },
    { categoryId: "fun", cents: 400 },
  ],
  [{ fromCategoryId: "fun", toCategoryId: "gas", cents: 1001 }],
);
assert.equal(duplicateDonorPlan.ok, false);

const unrelatedSourcePlan = validateOverspendTransferPlan(
  [{ categoryId: "fun", cents: 1000 }],
  [{ fromCategoryId: "groceries", toCategoryId: "gas", cents: 1000 }],
);
assert.equal(unrelatedSourcePlan.ok, false);

const balancedPlan = validateOverspendTransferPlan(
  [{ categoryId: "fun", cents: 1000 }],
  [
    { fromCategoryId: "fun", toCategoryId: "gas", cents: 600 },
    { fromCategoryId: "fun", toCategoryId: "dining", cents: 400 },
  ],
);
assert.equal(balancedPlan.ok, true);
if (balancedPlan.ok) {
  assert.equal(balancedPlan.donatedByCategory.get("fun"), 1000);
  assert.equal(balancedPlan.allocatedBySource.get("fun"), 1000);
}

const asOf = "2026-07-01";

function donor(
  overrides: Partial<OverspendDonorCandidate> & { categoryId: string },
): OverspendDonorCandidate {
  return {
    availableCents: 10_000,
    activityCents: 0,
    goalCents: null,
    goalFrequency: "monthly",
    goalDueOn: null,
    assignPriority: 0,
    assignMode: "percent",
    assignFixedCents: 0,
    assignPercent: 0,
    ...overrides,
  };
}

// Funded surplus ranks above an underfunded goal, even if the underfunded pile is larger.
const fundedSurplus = donor({
  categoryId: "fun",
  availableCents: 8_000,
  goalCents: 5_000,
  activityCents: -2_000,
});
const underfunded = donor({
  categoryId: "bills",
  availableCents: 20_000,
  goalCents: 40_000,
  goalDueOn: "2026-07-15",
  goalFrequency: "monthly",
});
assert.ok(
  overspendDonorSoftnessScore(fundedSurplus, asOf) >
    overspendDonorSoftnessScore(underfunded, asOf),
);

// Near-term due date is protected more than a distant one (same funding gap).
const dueSoon = donor({
  categoryId: "soon",
  availableCents: 5_000,
  goalCents: 12_000,
  goalFrequency: "monthly",
  goalDueOn: "2026-07-20",
});
const dueLater = donor({
  categoryId: "later",
  availableCents: 5_000,
  goalCents: 12_000,
  goalFrequency: "monthly",
  goalDueOn: "2027-07-01",
});
assert.ok(
  overspendDonorSoftnessScore(dueLater, asOf) >
    overspendDonorSoftnessScore(dueSoon, asOf),
);

// Auto Priority categories are protected vs plain buffers.
const buffer = donor({ categoryId: "buffer", availableCents: 9_000 });
const priority = donor({
  categoryId: "priority",
  availableCents: 9_000,
  assignPriority: 1,
});
assert.ok(
  overspendDonorSoftnessScore(buffer, asOf) >
    overspendDonorSoftnessScore(priority, asOf),
);

// Long-horizon, low-activity goals (savings-shaped) rank below no-goal buffers.
const longHorizon = donor({
  categoryId: "long",
  availableCents: 50_000,
  goalCents: 100_000,
  goalFrequency: "yearly",
  goalDueOn: "2027-12-31",
  activityCents: 0,
});
const noGoal = donor({
  categoryId: "flex",
  availableCents: 12_000,
  activityCents: -3_000,
});
assert.ok(
  overspendDonorSoftnessScore(noGoal, asOf) >
    overspendDonorSoftnessScore(longHorizon, asOf),
);

const ranked = rankOverspendDonors(
  [underfunded, longHorizon, priority, fundedSurplus, noGoal, dueSoon],
  asOf,
);
assert.equal(ranked[0]!.categoryId, "fun");
assert.ok(ranked.findIndex((row) => row.categoryId === "flex") < ranked.findIndex((row) => row.categoryId === "priority"));
assert.equal(ranked.at(-1)!.categoryId === "bills" || ranked.at(-1)!.categoryId === "soon" || ranked.at(-1)!.categoryId === "long", true);

// Manual protect flag removes a category from Fix Now donors entirely.
const protectedBuffer = donor({
  categoryId: "protected",
  availableCents: 99_000,
  excludeFromOverspendCover: true,
});
const openBuffer = donor({
  categoryId: "open",
  availableCents: 1_000,
});
const withoutProtected = rankOverspendDonors([protectedBuffer, openBuffer], asOf);
assert.deepEqual(
  withoutProtected.map((row) => row.categoryId),
  ["open"],
);

console.log("overspend-fix.test.ts: ok");

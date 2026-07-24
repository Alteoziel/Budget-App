import assert from "node:assert/strict";
import {
  allocateDonations,
  groupAllocationsByTarget,
  totalDonatedCents,
  totalShortfallCents,
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

console.log("overspend-fix.test.ts: ok");

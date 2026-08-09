import assert from "node:assert/strict";
import type { InsightsDataset } from "@/lib/insights/dataset";
import {
  deriveCategoryBreakdown,
  deriveCategoryTransactions,
  deriveInsights,
} from "@/lib/insights/derive";

const months = ["2026-01", "2026-02", "2026-03", "2026-04"];

const dataset: InsightsDataset = {
  months,
  accounts: [
    { id: "acc-1", name: "Checking", account_type: "checking" },
    { id: "acc-2", name: "Savings", account_type: "savings" },
  ],
  categories: [
    { id: "cat-1", name: "Groceries", groupName: "Everyday" },
    { id: "cat-2", name: "Dining", groupName: "Everyday" },
  ],
  cells: [
    // [monthIndex, accountIndex, categoryIndex, amountCents]
    [0, 0, -1, 200000], // income into checking
    [0, 0, 0, -50000], // groceries
    [1, 0, 0, -50000],
    [2, 0, 0, -50000],
    [3, 0, 1, -20000], // dining, latest month only
    [3, 1, -1, 10000], // savings inflow
  ],
  priorByAccount: [100000, 5000],
  payeeCells: [
    [0, 0, 1500],
    [1, 0, 1500],
    [2, 0, 1500],
  ],
  payees: ["streaming service"],
  txnCells: [
    [0, 0, 0, -50000, 5, 0],
    [1, 0, 0, -50000, 8, 0],
    [2, 0, 0, -50000, 12, 0],
    [3, 0, 1, -20000, 3, 1],
  ],
  txnPayees: ["Market", "Cafe"],
};

const all = deriveInsights(dataset, {
  monthsBack: 4,
  accountIds: [],
  categoryIds: [],
});

assert.equal(all.points.length, 4);
assert.equal(all.points[0]!.month, "2026-01");
assert.equal(all.points[0]!.incomeCents, 200000);
assert.equal(all.points[0]!.spendingCents, 50000);
// Prior balances (105000) + month one net (150000)
assert.equal(all.points[0]!.endBalanceCents, 255000);
assert.equal(all.points[3]!.incomeCents, 10000);
assert.equal(all.points[3]!.spendingCents, 20000);

// Recurring payee seen in three months is detected.
assert.ok(all.findings.some((f) => f.kind === "recurring_outflow"));

// Filtering by account excludes the savings inflow.
const checkingOnly = deriveInsights(dataset, {
  monthsBack: 4,
  accountIds: ["acc-1"],
  categoryIds: [],
});
assert.equal(checkingOnly.points[3]!.incomeCents, 0);

// Filtering by category keeps only that category's spending.
const diningOnly = deriveInsights(dataset, {
  monthsBack: 4,
  accountIds: [],
  categoryIds: ["cat-2"],
});
assert.equal(diningOnly.points[0]!.spendingCents, 0);
assert.equal(diningOnly.points[3]!.spendingCents, 20000);

// A shorter window rolls earlier months into the opening balance.
const lastTwo = deriveInsights(dataset, {
  monthsBack: 3,
  accountIds: [],
  categoryIds: [],
});
assert.equal(lastTwo.points.length, 3);
assert.equal(lastTwo.points[0]!.month, "2026-02");
assert.equal(
  lastTwo.points[2]!.endBalanceCents,
  all.points[3]!.endBalanceCents,
);

const breakdown = deriveCategoryBreakdown(dataset, ["2026-01", "2026-04"]);
assert.equal(breakdown.totalCents, 70000);
assert.equal(breakdown.rows.length, 2);
assert.equal(breakdown.rows[0]!.name, "Groceries");
assert.equal(breakdown.rows[0]!.cents, 50000);
assert.equal(breakdown.rows[1]!.name, "Dining");
assert.equal(breakdown.rows[1]!.cents, 20000);

const diningTxns = deriveCategoryTransactions(dataset, ["2026-04"], "cat-2");
assert.equal(diningTxns.length, 1);
assert.equal(diningTxns[0]!.payee, "Cafe");
assert.equal(diningTxns[0]!.occurredOn, "2026-04-03");
assert.equal(diningTxns[0]!.amountCents, -20000);

const emptyMonths = deriveCategoryBreakdown(dataset, []);
assert.equal(emptyMonths.totalCents, 0);
assert.equal(emptyMonths.rows.length, 0);

console.log("derive.test.ts: ok");

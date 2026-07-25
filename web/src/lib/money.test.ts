import assert from "node:assert/strict";
import {
  addBudgetMonths,
  budgetMonthDateRange,
  budgetMonthFromDate,
  budgetPagePath,
  computeReadyToAssignCents,
  currentBudgetMonth,
  dollarsToCents,
  formatBudgetDate,
  isBudgetMonth,
  isValidIsoDate,
  maxAssignableBudgetMonth,
  nextBudgetMonth,
  previousBudgetMonth,
} from "@/lib/money";

assert.equal(dollarsToCents("$1,234.56"), 123456);
assert.equal(dollarsToCents("(12.34)"), -1234);
assert.equal(dollarsToCents("-0.01"), -1);
assert.equal(dollarsToCents("0.1"), 10);
assert.equal(dollarsToCents("12.3"), 1230);

assert.equal(dollarsToCents("abc"), null);
assert.equal(dollarsToCents("12abc"), null);
assert.equal(dollarsToCents("1.005"), null);
assert.equal(dollarsToCents(""), null);
assert.equal(dollarsToCents("-"), null);
assert.equal(dollarsToCents("12.345"), null);

assert.equal(isBudgetMonth("2026-02"), true);
assert.equal(isBudgetMonth("2026-13"), false);
assert.equal(isBudgetMonth("2026-2"), false);

assert.equal(isValidIsoDate("2026-02-28"), true);
assert.equal(isValidIsoDate("2026-02-31"), false);
assert.equal(isValidIsoDate("2026-2-28"), false);

const feb = budgetMonthDateRange("2026-02");
assert.deepEqual(feb, { start: "2026-02-01", endExclusive: "2026-03-01" });

const dec = budgetMonthDateRange("2026-12");
assert.deepEqual(dec, { start: "2026-12-01", endExclusive: "2027-01-01" });

assert.equal(budgetMonthDateRange("2026-13"), null);

assert.equal(previousBudgetMonth("2026-03"), "2026-02");
assert.equal(previousBudgetMonth("2026-01"), "2025-12");
assert.equal(previousBudgetMonth("2026-13"), null);

assert.equal(nextBudgetMonth("2026-03"), "2026-04");
assert.equal(nextBudgetMonth("2026-12"), "2027-01");
assert.equal(nextBudgetMonth("2026-13"), null);

assert.equal(budgetMonthFromDate("2026-07-15"), "2026-07");
assert.equal(budgetMonthFromDate("2026-13-01"), null);
assert.equal(formatBudgetDate("2026-07-15"), "Jul 15, 2026");

assert.equal(addBudgetMonths("2026-07", 1), "2026-08");
assert.equal(addBudgetMonths("2026-12", 1), "2027-01");
assert.equal(addBudgetMonths("2026-01", -1), "2025-12");
assert.equal(addBudgetMonths("2026-07", 24), "2028-07");
assert.equal(addBudgetMonths("2026-13", 1), null);

assert.equal(maxAssignableBudgetMonth("2026-07", 24), "2028-07");
assert.equal(maxAssignableBudgetMonth("2026-07", 1), "2026-08");

// Assigning to a future month reduces Ready to assign by that amount.
assert.equal(
  computeReadyToAssignCents({
    uncategorizedPrior: 0,
    uncategorizedCurrent: 50_000,
    priorAssignedTotal: 0,
    totalAssigned: 10_000,
    futureAssignedTotal: 15_000,
  }),
  25_000,
);

assert.equal(
  computeReadyToAssignCents({
    uncategorizedPrior: 100_000,
    uncategorizedCurrent: 0,
    priorAssignedTotal: 40_000,
    totalAssigned: 20_000,
  }),
  40_000,
);

const liveMonth = currentBudgetMonth();
const futureMonth = nextBudgetMonth(liveMonth);
assert.ok(futureMonth);
assert.equal(budgetPagePath(), "/budget");
assert.equal(budgetPagePath({ month: liveMonth }), "/budget");
assert.equal(
  budgetPagePath({ month: futureMonth, assigned: 1234 }),
  `/budget?as=${futureMonth}&assigned=1234`,
);
assert.ok(
  budgetPagePath({ month: futureMonth, error: "Nope" }).startsWith(
    `/budget?as=${futureMonth}&error=`,
  ),
);

console.log("money.test.ts: ok");

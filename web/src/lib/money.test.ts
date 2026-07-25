import assert from "node:assert/strict";
import {
  budgetMonthDateRange,
  budgetMonthFromDate,
  dollarsToCents,
  formatBudgetDate,
  isBudgetMonth,
  isValidIsoDate,
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

console.log("money.test.ts: ok");

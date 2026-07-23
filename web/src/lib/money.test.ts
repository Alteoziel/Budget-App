import assert from "node:assert/strict";
import {
  budgetMonthDateRange,
  dollarsToCents,
  isBudgetMonth,
  previousBudgetMonth,
} from "@/lib/money";

assert.equal(dollarsToCents("$1,234.56"), 123456);
assert.equal(dollarsToCents("(12.34)"), -1234);
assert.equal(dollarsToCents("-0.01"), -1);

assert.equal(isBudgetMonth("2026-02"), true);
assert.equal(isBudgetMonth("2026-13"), false);
assert.equal(isBudgetMonth("2026-2"), false);

const feb = budgetMonthDateRange("2026-02");
assert.deepEqual(feb, { start: "2026-02-01", endExclusive: "2026-03-01" });

const dec = budgetMonthDateRange("2026-12");
assert.deepEqual(dec, { start: "2026-12-01", endExclusive: "2027-01-01" });

assert.equal(budgetMonthDateRange("2026-13"), null);

assert.equal(previousBudgetMonth("2026-03"), "2026-02");
assert.equal(previousBudgetMonth("2026-01"), "2025-12");
assert.equal(previousBudgetMonth("2026-13"), null);

console.log("money.test.ts: ok");

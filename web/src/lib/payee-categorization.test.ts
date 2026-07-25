import assert from "node:assert/strict";
import {
  PAYEE_TOKEN_COVERAGE_THRESHOLD,
  buildPayeeCategoryMemory,
  isIgnoredPayee,
  normalizePayee,
  payeeTokenCoverage,
  payeeTokens,
  resolveCategoryFromPayeeMemory,
  scorePayeeMatch,
} from "@/lib/payee-categorization";

assert.equal(normalizePayee("  THE Church of Jesus Christ! "), "the church of jesus christ");
assert.equal(normalizePayee("ACH*PAYPAL & SONS"), "ach paypal and sons");
assert.ok(isIgnoredPayee("Balance adjustment"));
assert.ok(isIgnoredPayee("Bank transaction"));
assert.equal(isIgnoredPayee("Costco"), false);

assert.deepEqual(payeeTokens("the church of jesus christ"), [
  "church",
  "jesus",
  "christ",
]);

const tithing = "cat-tithing";
const groceries = "cat-groceries";

const memory = buildPayeeCategoryMemory([
  {
    payee: "THE CHURCH OF JESUS CHRIST",
    category_id: tithing,
    occurred_on: "2026-07-01",
  },
  {
    payee: "COSTCO WHOLESALE #123",
    category_id: groceries,
    occurred_on: "2026-07-10",
  },
  {
    payee: "Balance adjustment",
    category_id: groceries,
    occurred_on: "2026-07-11",
  },
]);

assert.equal(
  resolveCategoryFromPayeeMemory("The Church of Jesus Christ", memory),
  tithing,
);
assert.equal(
  resolveCategoryFromPayeeMemory("CHURCH OF JESUS CHRIST OF LATTER-DAY SAINTS", memory),
  tithing,
);
assert.equal(
  resolveCategoryFromPayeeMemory("COSTCO WHOLESALE #999", memory),
  groceries,
);
assert.equal(resolveCategoryFromPayeeMemory("Random Cafe Downtown", memory), null);
assert.equal(resolveCategoryFromPayeeMemory("Balance adjustment", memory), null);

const churchTokens = payeeTokens(
  normalizePayee("CHURCH OF JESUS CHRIST OF LATTER-DAY SAINTS"),
);
const example = memory.examples.find((row) => row.categoryId === tithing);
assert.ok(example);
assert.ok(
  payeeTokenCoverage(example.tokens, churchTokens) >=
    PAYEE_TOKEN_COVERAGE_THRESHOLD,
);
assert.ok(
  scorePayeeMatch(
    normalizePayee("CHURCH OF JESUS CHRIST OF LATTER-DAY SAINTS"),
    churchTokens,
    example,
  ) >= PAYEE_TOKEN_COVERAGE_THRESHOLD,
);

// Most recent exact match wins when rows are newest-first (loader order).
const flipped = buildPayeeCategoryMemory([
  {
    payee: "STARBUCKS",
    category_id: "new",
    occurred_on: "2026-06-01",
  },
  {
    payee: "Starbucks",
    category_id: "old",
    occurred_on: "2026-01-01",
  },
]);
assert.equal(resolveCategoryFromPayeeMemory("starbucks store", flipped), "new");
assert.equal(resolveCategoryFromPayeeMemory("Starbucks", flipped), "new");
assert.equal(resolveCategoryFromPayeeMemory("Totally Unrelated Shop", flipped), null);

console.log("payee-categorization.test.ts: ok");

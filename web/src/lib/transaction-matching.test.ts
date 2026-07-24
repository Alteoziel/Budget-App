import assert from "node:assert/strict";
import {
  BALANCE_ANCHOR_PREFIX,
  MATCH_AMOUNT_TOLERANCE_CENTS,
  MATCH_DATE_WINDOW_DAYS,
  balanceAnchorExternalId,
  isBalanceAnchorExternalId,
  isBankExternalId,
} from "@/lib/transaction-matching";

assert.equal(balanceAnchorExternalId("abc"), `${BALANCE_ANCHOR_PREFIX}abc`);
assert.equal(isBalanceAnchorExternalId("balance-anchor:abc"), true);
assert.equal(isBalanceAnchorExternalId("plaid:xyz"), false);
assert.equal(isBankExternalId("plaid:xyz"), true);
assert.equal(isBankExternalId("teller:xyz"), true);
assert.equal(isBankExternalId("balance-anchor:abc"), false);
assert.equal(isBankExternalId(null), false);
assert.ok(MATCH_AMOUNT_TOLERANCE_CENTS >= 0);
assert.ok(MATCH_DATE_WINDOW_DAYS >= 1);

console.log("transaction-matching.test.ts: ok");

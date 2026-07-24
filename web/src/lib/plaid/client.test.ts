import assert from "node:assert/strict";
import {
  mapPlaidAccountType,
  plaidAmountToCents,
  plaidErrorMessage,
} from "@/lib/plaid/client";

assert.equal(plaidAmountToCents(12.5), -1250); // outflow
assert.equal(plaidAmountToCents(-100), 10000); // inflow
assert.equal(plaidAmountToCents(0), 0);
assert.equal(mapPlaidAccountType("depository", "checking"), "checking");
assert.equal(mapPlaidAccountType("credit", "credit card"), "credit");
assert.equal(mapPlaidAccountType("depository", "savings"), "savings");
assert.equal(
  plaidErrorMessage({
    response: { data: { error_code: "INVALID_API_KEYS", error_message: "invalid" } },
  }),
  "INVALID_API_KEYS: invalid",
);
assert.equal(plaidErrorMessage(new Error("boom")), "boom");

console.log("plaid/client.test.ts: ok");

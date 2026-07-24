import assert from "node:assert/strict";
import { mapTellerAccountType, tellerAmountToCents } from "@/lib/teller/client";

assert.equal(tellerAmountToCents("-12.50"), -1250);
assert.equal(tellerAmountToCents("100.00"), 10000);
assert.equal(tellerAmountToCents("0"), 0);
assert.equal(mapTellerAccountType("depository", "checking"), "checking");
assert.equal(mapTellerAccountType("credit", "credit_card"), "credit");
assert.equal(mapTellerAccountType("depository", "savings"), "savings");

console.log("client.test.ts: ok");

import assert from "node:assert/strict";
import {
  findRelinkDuplicateIds,
  plaidTxnFingerprint,
} from "@/lib/plaid/dedupe";

assert.equal(
  plaidTxnFingerprint({
    occurred_on: "2026-07-24",
    amount_cents: 400000,
    payee: " Zelle ",
  }),
  "2026-07-24|400000|Zelle",
);

const remove = findRelinkDuplicateIds([
  {
    id: "old",
    occurred_on: "2026-07-24",
    payee: "Zelle",
    amount_cents: 400000,
    external_id: "plaid:old",
    created_at: "2026-07-24T17:00:00.000Z",
  },
  {
    id: "new",
    occurred_on: "2026-07-24",
    payee: "Zelle",
    amount_cents: 400000,
    external_id: "plaid:new",
    created_at: "2026-07-27T21:00:00.000Z",
  },
  // Legitimate same-day pair imported together — do not remove.
  {
    id: "a1",
    occurred_on: "2026-06-02",
    payee: "Transfer",
    amount_cents: 80000,
    external_id: "plaid:a1",
    created_at: "2026-07-27T21:00:01.000Z",
  },
  {
    id: "a2",
    occurred_on: "2026-06-02",
    payee: "Transfer",
    amount_cents: 80000,
    external_id: "plaid:a2",
    created_at: "2026-07-27T21:00:02.000Z",
  },
  // Same fingerprint also present on older wave twice → keep 2 newest.
  {
    id: "b1",
    occurred_on: "2026-06-02",
    payee: "Transfer",
    amount_cents: 80000,
    external_id: "plaid:b1",
    created_at: "2026-07-24T17:00:01.000Z",
  },
  {
    id: "b2",
    occurred_on: "2026-06-02",
    payee: "Transfer",
    amount_cents: 80000,
    external_id: "plaid:b2",
    created_at: "2026-07-24T17:00:02.000Z",
  },
  {
    id: "manual",
    occurred_on: "2026-11-18",
    payee: "",
    amount_cents: 400000,
    external_id: null,
    created_at: "2026-11-18T15:00:00.000Z",
  },
]);

assert.deepEqual(remove.sort(), ["b1", "b2", "old"].sort());
console.log("dedupe.test.ts: ok");

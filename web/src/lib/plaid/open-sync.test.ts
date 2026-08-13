import assert from "node:assert/strict";
import {
  formatOpenSyncNotice,
  PLAID_OPEN_SYNC_DEBOUNCE_MS,
} from "@/lib/plaid/open-sync";

assert.equal(PLAID_OPEN_SYNC_DEBOUNCE_MS, 60 * 60 * 1000);

assert.equal(
  formatOpenSyncNotice({ inserted: 3, updated: 0, errors: [] }),
  "Imported 3 new transactions",
);
assert.equal(
  formatOpenSyncNotice({ inserted: 1, updated: 0, errors: [] }),
  "Imported 1 new transaction",
);
assert.equal(
  formatOpenSyncNotice({ inserted: 0, updated: 2, errors: [] }),
  "Updated 2 transactions",
);
assert.equal(
  formatOpenSyncNotice({ inserted: 0, updated: 0, errors: [] }),
  "Bank is up to date",
);
assert.equal(
  formatOpenSyncNotice({
    skipped: true,
    reason: "Recent sync already in progress or finished",
  }),
  "Bank already synced",
);
assert.equal(
  formatOpenSyncNotice({ skipped: true, reason: "No bank connections" }),
  "No bank linked yet",
);
assert.equal(
  formatOpenSyncNotice({
    inserted: 0,
    updated: 0,
    errors: ["Could not link any Plaid accounts into this budget."],
  }),
  "Could not link any Plaid accounts into this budget.",
);

console.log("open-sync.test.ts: ok");

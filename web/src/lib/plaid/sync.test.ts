import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

process.env.BANK_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests";
process.env.PLAID_CLIENT_ID = "test-client-id";
process.env.PLAID_SECRET = "test-secret";
process.env.PLAID_ENV = "sandbox";

type QueryResult = { data: unknown; error: { message: string } | null };

/** Minimal thenable query builder for syncPlaidItem unit tests. */
function mockSupabase(options?: {
  onItemUpdate?: (payload: Record<string, unknown>) => void;
}): SupabaseClient {
  const from = (table: string) => {
    const state: {
      payload?: Record<string, unknown>;
    } = {};
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      update: (payload: Record<string, unknown>) => {
        state.payload = payload;
        return chain;
      },
      then: (resolve: (value: QueryResult) => unknown) => {
        if (table === "plaid_items" && state.payload) {
          options?.onItemUpdate?.(state.payload);
        }
        if (table === "plaid_accounts") {
          return Promise.resolve(
            resolve({ data: [], error: null }),
          );
        }
        if (table === "transactions") {
          return Promise.resolve(
            resolve({ data: [], error: null }),
          );
        }
        return Promise.resolve(resolve({ data: null, error: null }));
      },
    };
    return chain;
  };

  return { from } as unknown as SupabaseClient;
}

async function main() {
  const { encryptSecret } = await import("@/lib/crypto/secrets");
  const {
    syncPlaidItem,
    plaidExternalId,
    plaidTransactionImportFields,
    formatManualSyncNotice,
  } = await import("@/lib/plaid/sync");

  assert.equal(plaidExternalId("txn_abc"), "plaid:txn_abc");

  // Pending authorizations must be importable (uncleared), not dropped.
  const pendingFields = plaidTransactionImportFields({
    transaction_id: "pending-1",
    pending: true,
    pending_transaction_id: null,
    amount: 12.34,
    date: "2026-07-27",
    merchant_name: "Coffee Shop",
    name: "COFFEE SHOP",
  });
  assert.equal(pendingFields.cleared, false);
  assert.equal(pendingFields.amountCents, -1234);
  assert.equal(pendingFields.externalId, "plaid:pending-1");
  assert.equal(pendingFields.pendingExternalId, null);
  assert.equal(pendingFields.payee, "Coffee Shop");

  // Posted replacement links back to the pending id so we can upgrade in place.
  const postedFields = plaidTransactionImportFields({
    transaction_id: "posted-1",
    pending: false,
    pending_transaction_id: "pending-1",
    amount: 12.34,
    date: "2026-07-28",
    merchant_name: null,
    name: "COFFEE SHOP",
  });
  assert.equal(postedFields.cleared, true);
  assert.equal(postedFields.externalId, "plaid:posted-1");
  assert.equal(postedFields.pendingExternalId, "plaid:pending-1");

  const emptyNotice = formatManualSyncNotice({
    inserted: 0,
    updated: 0,
    removed: 0,
    errors: [],
    skippedUnmapped: 0,
    pendingImported: 0,
    plaidAdded: 0,
    plaidModified: 0,
    accountsLinked: 1,
    plaidAccountCount: 1,
    accountLinkErrors: [],
    refreshRequested: false,
    refreshNote: null,
    plaidLastSuccessfulUpdate: "2026-07-27T12:00:00.000Z",
  });
  assert.match(emptyNotice, /No new transactions from Plaid/);
  assert.match(emptyNotice, /don’t need to disconnect|do not need to disconnect/i);

  const importedNotice = formatManualSyncNotice({
    inserted: 8,
    updated: 0,
    removed: 0,
    errors: [],
    skippedUnmapped: 0,
    pendingImported: 5,
    plaidAdded: 8,
    plaidModified: 0,
    accountsLinked: 2,
    plaidAccountCount: 2,
    accountLinkErrors: [],
    refreshRequested: true,
    refreshNote: null,
    plaidLastSuccessfulUpdate: null,
  });
  assert.match(importedNotice, /Imported 8 transactions \(5 pending\)/);
  assert.doesNotMatch(importedNotice, /don’t need to disconnect/);

  const unmappedNotice = formatManualSyncNotice({
    inserted: 0,
    updated: 0,
    removed: 0,
    errors: ["Could not link any Plaid accounts into this budget."],
    skippedUnmapped: 184,
    pendingImported: 0,
    plaidAdded: 184,
    plaidModified: 0,
    accountsLinked: 0,
    plaidAccountCount: 2,
    accountLinkErrors: ["Could not link any Plaid accounts into this budget."],
    refreshRequested: false,
    refreshNote: null,
    plaidLastSuccessfulUpdate: null,
  });
  assert.match(unmappedNotice, /Could not link any Plaid accounts/);
  assert.match(unmappedNotice, /184 transactions could not be imported/);

  const { pickReusableLocalAccount, plaidAccountDisplayName } = await import(
    "@/lib/plaid/sync"
  );
  assert.equal(
    plaidAccountDisplayName(
      { name: "Checking", mask: "1234", type: "depository", subtype: "checking" },
      "Chase",
    ),
    "Checking",
  );
  assert.equal(
    pickReusableLocalAccount(
      [
        { id: "a1", name: "Checking", account_type: "checking" },
        { id: "a2", name: "Savings", account_type: "savings" },
      ],
      new Set(),
      { name: "Checking", accountType: "checking", mask: "1234" },
    ),
    "a1",
  );
  assert.equal(
    pickReusableLocalAccount(
      [{ id: "a1", name: "Chase Checking ·1234", account_type: "checking" }],
      new Set(),
      { name: "Plaid Checking", accountType: "checking", mask: "1234" },
    ),
    "a1",
  );

  const goodCipher = encryptSecret("access-sandbox-test-token");

  function lastStatus(updates: Record<string, unknown>[]) {
    const last = updates[updates.length - 1];
    return last ? last["status"] : undefined;
  }

  // Missing encryption key must not throw out to the RSC error boundary.
  const previousKey = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  delete process.env.BANK_TOKEN_ENCRYPTION_KEY;
  const missingKeyUpdates: Record<string, unknown>[] = [];
  const missingKeyResult = await syncPlaidItem(
    mockSupabase({
      onItemUpdate: (payload) => {
        missingKeyUpdates.push(payload);
      },
    }),
    {
      id: "item-1",
      budget_id: "budget-1",
      access_token_encrypted: goodCipher,
      sync_cursor: null,
      created_by: "user-1",
    },
  );
  assert.equal(missingKeyResult.inserted, 0);
  assert.equal(missingKeyResult.errors.length, 1);
  assert.match(missingKeyResult.errors[0]!, /BANK_TOKEN_ENCRYPTION_KEY/);
  assert.equal(lastStatus(missingKeyUpdates), "error");
  process.env.BANK_TOKEN_ENCRYPTION_KEY = previousKey;

  // Rotated / invalid ciphertext must return an error result, not throw.
  const badCipherUpdates: Record<string, unknown>[] = [];
  const badCipherResult = await syncPlaidItem(
    mockSupabase({
      onItemUpdate: (payload) => {
        badCipherUpdates.push(payload);
      },
    }),
    {
      id: "item-2",
      budget_id: "budget-1",
      access_token_encrypted: "00:00112233445566778899aabbccddeeff:abcd",
      sync_cursor: null,
      created_by: "user-1",
    },
  );
  assert.equal(badCipherResult.errors.length, 1);
  assert.ok(badCipherResult.errors[0]);
  assert.equal(lastStatus(badCipherUpdates), "error");

  // Valid ciphertext + missing Plaid API keys must also stay non-throwing.
  const previousClient = process.env.PLAID_CLIENT_ID;
  const previousSecret = process.env.PLAID_SECRET;
  delete process.env.PLAID_CLIENT_ID;
  delete process.env.PLAID_SECRET;
  const missingPlaidUpdates: Record<string, unknown>[] = [];
  const missingPlaidResult = await syncPlaidItem(
    mockSupabase({
      onItemUpdate: (payload) => {
        missingPlaidUpdates.push(payload);
      },
    }),
    {
      id: "item-3",
      budget_id: "budget-1",
      access_token_encrypted: goodCipher,
      sync_cursor: null,
      created_by: "user-1",
    },
  );
  assert.equal(missingPlaidResult.errors.length, 1);
  assert.match(missingPlaidResult.errors[0]!, /PLAID_CLIENT_ID|PLAID_SECRET/);
  assert.equal(lastStatus(missingPlaidUpdates), "error");
  process.env.PLAID_CLIENT_ID = previousClient;
  process.env.PLAID_SECRET = previousSecret;

  console.log("plaid/sync.test.ts: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

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
  const { syncPlaidItem } = await import("@/lib/plaid/sync");

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

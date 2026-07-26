import type { SupabaseClient } from "@supabase/supabase-js";
import type { RemovedTransaction, Transaction as PlaidTxn } from "plaid";
import {
  getPlaidClient,
  mapPlaidAccountType,
  plaidAmountToCents,
  plaidErrorMessage,
} from "@/lib/plaid/client";
import { decryptSecret } from "@/lib/crypto/secrets";
import {
  loadPayeeCategoryMemory,
  resolveCategoryFromPayeeMemory,
  type PayeeCategoryMemory,
} from "@/lib/payee-categorization";
import { suggestMatchForBankTransaction } from "@/lib/transaction-matching";

export type SyncResult = {
  inserted: number;
  updated: number;
  removed: number;
  errors: string[];
};

type ItemRow = {
  id: string;
  budget_id: string;
  access_token_encrypted: string;
  sync_cursor: string | null;
  created_by: string;
};

async function markPlaidItemSyncError(
  supabase: SupabaseClient,
  item: ItemRow,
  message: string,
) {
  await supabase
    .from("plaid_items")
    .update({
      last_error: message.slice(0, 1000),
      status: "error",
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id)
    .eq("budget_id", item.budget_id);
}

export async function syncPlaidItem(
  supabase: SupabaseClient,
  item: ItemRow,
): Promise<SyncResult> {
  const result: SyncResult = { inserted: 0, updated: 0, removed: 0, errors: [] };

  // Decrypt / client setup must stay inside try/catch — missing Doppler secrets
  // or a rotated BANK_TOKEN_ENCRYPTION_KEY used to throw out of Sync now into
  // the authenticated error boundary ("Couldn't load / Server error").
  let accessToken: string;
  let client: ReturnType<typeof getPlaidClient>;
  try {
    accessToken = decryptSecret(item.access_token_encrypted);
    client = getPlaidClient();
  } catch (e) {
    const message = plaidErrorMessage(e, "Plaid sync failed");
    result.errors.push(message);
    try {
      await markPlaidItemSyncError(supabase, item, message);
    } catch {
      // Best-effort status write; still return the sync error to the caller.
    }
    return result;
  }

  const { data: maps, error: mapErr } = await supabase
    .from("plaid_accounts")
    .select("plaid_account_id,account_id")
    .eq("plaid_item_id", item.id)
    .eq("budget_id", item.budget_id);
  if (mapErr) {
    result.errors.push(mapErr.message);
    return result;
  }

  const accountByPlaid = new Map(
    (maps ?? []).map((m) => [m.plaid_account_id as string, m.account_id as string]),
  );

  // Learn categories from prior payee assignments once per sync pass.
  const payeeMemory = await loadPayeeCategoryMemory(supabase, item.budget_id);

  let cursor = item.sync_cursor ?? undefined;
  let hasMore = true;

  try {
    while (hasMore) {
      const response = await client.transactionsSync({
        access_token: accessToken,
        cursor,
      });
      const data = response.data;

      for (const txn of data.added) {
        const counts = await upsertPlaidTransaction(supabase, {
          budgetId: item.budget_id,
          userId: item.created_by,
          accountByPlaid,
          payeeMemory,
          txn,
        });
        result.inserted += counts.inserted;
        result.updated += counts.updated;
      }
      for (const txn of data.modified) {
        const counts = await upsertPlaidTransaction(supabase, {
          budgetId: item.budget_id,
          userId: item.created_by,
          accountByPlaid,
          payeeMemory,
          txn,
        });
        result.inserted += counts.inserted;
        result.updated += counts.updated;
      }
      for (const txn of data.removed) {
        result.removed += await removePlaidTransaction(supabase, item.budget_id, txn);
      }

      cursor = data.next_cursor;
      hasMore = data.has_more;
    }

    await supabase
      .from("plaid_items")
      .update({
        sync_cursor: cursor ?? null,
        last_synced_at: new Date().toISOString(),
        last_error: null,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("budget_id", item.budget_id);
  } catch (e) {
    const message = plaidErrorMessage(e, "Plaid sync failed");
    result.errors.push(message);
    try {
      await markPlaidItemSyncError(supabase, item, message);
    } catch {
      // Best-effort status write.
    }
  }

  return result;
}

async function upsertPlaidTransaction(
  supabase: SupabaseClient,
  args: {
    budgetId: string;
    userId: string;
    accountByPlaid: Map<string, string>;
    payeeMemory: PayeeCategoryMemory;
    txn: PlaidTxn;
  },
): Promise<{ inserted: number; updated: number }> {
  const accountId = args.accountByPlaid.get(args.txn.account_id);
  if (!accountId) return { inserted: 0, updated: 0 };
  if (args.txn.pending) return { inserted: 0, updated: 0 };

  const amountCents = plaidAmountToCents(args.txn.amount);
  if (amountCents === 0) return { inserted: 0, updated: 0 };

  const externalId = `plaid:${args.txn.transaction_id}`;
  const payee = (args.txn.merchant_name || args.txn.name || "Bank transaction").slice(
    0,
    200,
  );
  const suggestedCategoryId = resolveCategoryFromPayeeMemory(
    payee,
    args.payeeMemory,
  );
  const row = {
    user_id: args.userId,
    budget_id: args.budgetId,
    account_id: accountId,
    category_id: suggestedCategoryId,
    occurred_on: args.txn.date,
    payee,
    memo: "",
    amount_cents: amountCents,
    cleared: true,
    external_id: externalId,
  };

  const { data: existing } = await supabase
    .from("transactions")
    .select("id,amount_cents,occurred_on,payee")
    .eq("budget_id", args.budgetId)
    .eq("external_id", externalId)
    .maybeSingle();

  if (existing?.id) {
    const changed =
      existing.amount_cents !== row.amount_cents ||
      existing.occurred_on !== row.occurred_on ||
      existing.payee !== row.payee;
    if (!changed) return { inserted: 0, updated: 0 };
    const { error } = await supabase
      .from("transactions")
      .update({
        amount_cents: row.amount_cents,
        occurred_on: row.occurred_on,
        payee: row.payee,
        cleared: true,
      })
      .eq("id", existing.id);
    if (error) throw error;
    return { inserted: 0, updated: 1 };
  }

  const { data: inserted, error } = await supabase
    .from("transactions")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    if (error.message.toLowerCase().includes("duplicate")) {
      return { inserted: 0, updated: 0 };
    }
    throw error;
  }

  if (inserted?.id) {
    try {
      await suggestMatchForBankTransaction(supabase, {
        budgetId: args.budgetId,
        accountId,
        bankTransactionId: inserted.id,
        amountCents,
        occurredOn: args.txn.date,
      });
    } catch {
      // Matching is best-effort; sync should still succeed.
    }
  }

  return { inserted: 1, updated: 0 };
}

async function removePlaidTransaction(
  supabase: SupabaseClient,
  budgetId: string,
  txn: RemovedTransaction,
): Promise<number> {
  if (!txn.transaction_id) return 0;
  const { data, error } = await supabase
    .from("transactions")
    .delete()
    .eq("budget_id", budgetId)
    .eq("external_id", `plaid:${txn.transaction_id}`)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function ensureLocalAccountsForItem(
  supabase: SupabaseClient,
  args: {
    budgetId: string;
    userId: string;
    itemRowId: string;
    accessToken: string;
    institutionName: string;
  },
): Promise<number> {
  const client = getPlaidClient();
  const accountsRes = await client.accountsGet({ access_token: args.accessToken });
  let linked = 0;

  for (const account of accountsRes.data.accounts) {
    const { data: existingMap } = await supabase
      .from("plaid_accounts")
      .select("id,account_id")
      .eq("budget_id", args.budgetId)
      .eq("plaid_account_id", account.account_id)
      .maybeSingle();

    let accountId = existingMap?.account_id as string | undefined;
    if (!accountId) {
      const name =
        account.name ||
        account.official_name ||
        `${args.institutionName} ${account.subtype || account.type}${
          account.mask ? ` ·${account.mask}` : ""
        }`;

      const { data: maxSort } = await supabase
        .from("accounts")
        .select("sort_order")
        .eq("budget_id", args.budgetId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextSortOrder = Number(maxSort?.sort_order ?? -1) + 1;
      const baseRow = {
        user_id: args.userId,
        budget_id: args.budgetId,
        name: name.slice(0, 80),
        account_type: mapPlaidAccountType(account.type, account.subtype),
        currency: (account.balances.iso_currency_code || "USD").toUpperCase(),
      };

      let created: { id: string } | null = null;
      let error: { message: string } | null = null;
      ({ data: created, error } = await supabase
        .from("accounts")
        .insert({
          ...baseRow,
          include_in_total: true,
          sort_order: nextSortOrder,
        })
        .select("id")
        .single());

      if (error && /include_in_total|sort_order|schema cache|column/i.test(error.message)) {
        ({ data: created, error } = await supabase
          .from("accounts")
          .insert(baseRow)
          .select("id")
          .single());
      }

      if (error || !created) {
        const { data: retry } = await supabase
          .from("accounts")
          .insert({
            ...baseRow,
            name: `${name.slice(0, 60)} (${account.account_id.slice(-6)})`,
            include_in_total: true,
            sort_order: nextSortOrder,
          })
          .select("id")
          .single();
        accountId = retry?.id;
      } else {
        accountId = created.id;
      }
    }

    if (!accountId) continue;

    await supabase.from("plaid_accounts").upsert(
      {
        budget_id: args.budgetId,
        plaid_item_id: args.itemRowId,
        plaid_account_id: account.account_id,
        account_id: accountId,
      },
      { onConflict: "budget_id,plaid_account_id" },
    );
    linked += 1;
  }

  return linked;
}

export type SyncRunSource = "teller" | "plaid" | "cron" | "manual" | "catchup";

export type SyncAllOptions = {
  source?: SyncRunSource;
  /** Extra attempts after the first failure (default 1 → two tries total). */
  retries?: number;
  /** Limit to one budget (catch-up). */
  budgetId?: string;
  /** Limit to specific item ids. */
  itemIds?: string[];
};

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncPlaidItemWithRetry(
  supabase: SupabaseClient,
  item: ItemRow,
  retries: number,
): Promise<SyncResult> {
  let attempt = 0;
  let result = await syncPlaidItem(supabase, item);
  while (result.errors.length > 0 && attempt < retries) {
    attempt += 1;
    await sleep(500 * attempt);
    result = await syncPlaidItem(supabase, item);
  }
  return result;
}

export async function syncAllActivePlaidItems(
  supabase: SupabaseClient,
  options: SyncAllOptions = {},
): Promise<{ runs: number; inserted: number; updated: number; removed: number; errors: string[] }> {
  const source = options.source ?? "cron";
  const retries = options.retries ?? 1;

  let query = supabase
    .from("plaid_items")
    .select("id,budget_id,access_token_encrypted,sync_cursor,created_by,status")
    .neq("status", "disconnected");
  if (options.budgetId) query = query.eq("budget_id", options.budgetId);
  if (options.itemIds?.length) query = query.in("id", options.itemIds);

  const { data: items, error } = await query;
  if (error) throw new Error(error.message);

  let inserted = 0;
  let updated = 0;
  let removed = 0;
  const errors: string[] = [];
  let runs = 0;

  for (const item of items ?? []) {
    runs += 1;
    const started = new Date().toISOString();

    // Record the attempt immediately so a crash still leaves a trail.
    const { data: runRow } = await supabase
      .from("sync_runs")
      .insert({
        budget_id: item.budget_id,
        plaid_item_id: item.id,
        source,
        started_at: started,
        finished_at: null,
        inserted: 0,
        updated: 0,
        errors: null,
      })
      .select("id")
      .maybeSingle();

    const result = await syncPlaidItemWithRetry(supabase, item, retries);
    inserted += result.inserted;
    updated += result.updated;
    removed += result.removed;
    if (result.errors.length) {
      errors.push(`[${item.id}] ${result.errors.join("; ")}`);
    }

    const finished = {
      finished_at: new Date().toISOString(),
      inserted: result.inserted,
      updated: result.updated,
      errors: result.errors.length ? result.errors.join("\n").slice(0, 4000) : null,
    };

    if (runRow?.id) {
      await supabase.from("sync_runs").update(finished).eq("id", runRow.id);
    } else {
      await supabase.from("sync_runs").insert({
        budget_id: item.budget_id,
        plaid_item_id: item.id,
        source,
        started_at: started,
        ...finished,
      });
    }
  }

  return { runs, inserted, updated, removed, errors };
}

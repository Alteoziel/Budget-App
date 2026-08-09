import type { SupabaseClient } from "@supabase/supabase-js";
import type { RemovedTransaction, Transaction as PlaidTxn } from "plaid";
import {
  getPlaidClient,
  mapPlaidAccountType,
  plaidAmountToCents,
  plaidErrorCode,
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
  /** Plaid returned txns for accounts we have no local mapping for. */
  skippedUnmapped: number;
  /** Pending authorizations stored as uncleared. */
  pendingImported: number;
  /** Raw added/modified counts from Plaid before local filters. */
  plaidAdded: number;
  plaidModified: number;
};

export type ManualSyncResult = SyncResult & {
  accountsLinked: number;
  plaidAccountCount: number;
  accountLinkErrors: string[];
  refreshRequested: boolean;
  refreshNote: string | null;
  plaidLastSuccessfulUpdate: string | null;
};

export type EnsureAccountsResult = {
  linked: number;
  plaidAccountCount: number;
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

export type SyncPlaidItemOptions = {
  /**
   * Start from an empty cursor so Plaid re-sends the full available window.
   * Used by manual "Sync now" to recover transactions previously skipped
   * (e.g. pending authorizations that advanced the cursor without being stored).
   */
  resetCursor?: boolean;
};

function emptySyncResult(): SyncResult {
  return {
    inserted: 0,
    updated: 0,
    removed: 0,
    errors: [],
    skippedUnmapped: 0,
    pendingImported: 0,
    plaidAdded: 0,
    plaidModified: 0,
  };
}

function mergeSyncResults(into: SyncResult, from: SyncResult): SyncResult {
  into.inserted += from.inserted;
  into.updated += from.updated;
  into.removed += from.removed;
  into.skippedUnmapped += from.skippedUnmapped;
  into.pendingImported += from.pendingImported;
  into.plaidAdded += from.plaidAdded;
  into.plaidModified += from.plaidModified;
  into.errors.push(...from.errors);
  return into;
}

/** Plaid asks us to restart the whole page loop from the original cursor. */
export function isPlaidSyncMutationDuringPagination(error: unknown): boolean {
  return plaidErrorCode(error) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
}

const MAX_SYNC_MUTATION_RETRIES = 5;

type SyncPageBatch = {
  added: PlaidTxn[];
  modified: PlaidTxn[];
  removed: RemovedTransaction[];
  nextCursor: string | null;
  plaidAdded: number;
  plaidModified: number;
};

/**
 * Pull every page for one sync update. On MUTATION_DURING_PAGINATION, callers
 * must discard this batch and restart from the same original cursor — never
 * retry only the failed page, and never persist the cursor until has_more is
 * false (Plaid Transactions sync contract).
 */
export async function fetchPlaidSyncPages(
  client: ReturnType<typeof getPlaidClient>,
  accessToken: string,
  originalCursor: string | undefined,
): Promise<SyncPageBatch> {
  let cursor = originalCursor;
  let hasMore = true;
  const added: PlaidTxn[] = [];
  const modified: PlaidTxn[] = [];
  const removed: RemovedTransaction[] = [];
  let nextCursor: string | null = originalCursor ?? null;

  while (hasMore) {
    const response = await client.transactionsSync({
      access_token: accessToken,
      cursor,
    });
    const data = response.data;
    added.push(...data.added);
    modified.push(...data.modified);
    removed.push(...data.removed);
    nextCursor = data.next_cursor ?? null;
    cursor = data.next_cursor;
    hasMore = data.has_more;
  }

  return {
    added,
    modified,
    removed,
    nextCursor,
    plaidAdded: added.length,
    plaidModified: modified.length,
  };
}

export async function syncPlaidItem(
  supabase: SupabaseClient,
  item: ItemRow,
  options: SyncPlaidItemOptions = {},
): Promise<SyncResult> {
  const result = emptySyncResult();

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

  // Keep the cursor that started this update so MUTATION_DURING_PAGINATION can
  // restart the entire page loop (not the failed page alone).
  const originalCursor = options.resetCursor
    ? undefined
    : (item.sync_cursor ?? undefined);

  try {
    let batch: SyncPageBatch | null = null;
    for (let attempt = 0; attempt <= MAX_SYNC_MUTATION_RETRIES; attempt += 1) {
      try {
        batch = await fetchPlaidSyncPages(client, accessToken, originalCursor);
        break;
      } catch (e) {
        if (
          isPlaidSyncMutationDuringPagination(e) &&
          attempt < MAX_SYNC_MUTATION_RETRIES
        ) {
          // Underlying data changed mid-pagination — discard pages and restart
          // from the original cursor per Plaid's sync contract.
          continue;
        }
        throw e;
      }
    }

    if (!batch) {
      throw new Error("Plaid sync pagination failed after mutation retries.");
    }

    result.plaidAdded += batch.plaidAdded;
    result.plaidModified += batch.plaidModified;

    // Apply only after every page for this update was retrieved successfully.
    for (const txn of batch.added) {
      const counts = await upsertPlaidTransaction(supabase, {
        budgetId: item.budget_id,
        userId: item.created_by,
        accountByPlaid,
        payeeMemory,
        txn,
      });
      result.inserted += counts.inserted;
      result.updated += counts.updated;
      result.skippedUnmapped += counts.skippedUnmapped;
      result.pendingImported += counts.pendingImported;
    }
    for (const txn of batch.modified) {
      const counts = await upsertPlaidTransaction(supabase, {
        budgetId: item.budget_id,
        userId: item.created_by,
        accountByPlaid,
        payeeMemory,
        txn,
      });
      result.inserted += counts.inserted;
      result.updated += counts.updated;
      result.skippedUnmapped += counts.skippedUnmapped;
      result.pendingImported += counts.pendingImported;
    }
    for (const txn of batch.removed) {
      result.removed += await removePlaidTransaction(supabase, item.budget_id, txn);
    }

    await supabase
      .from("plaid_items")
      .update({
        sync_cursor: batch.nextCursor,
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

/** Stable external_id for a Plaid transaction_id. */
export function plaidExternalId(transactionId: string): string {
  return `plaid:${transactionId}`;
}

/** Fields we persist from a Plaid transaction (pending included as uncleared). */
export function plaidTransactionImportFields(txn: {
  transaction_id: string;
  pending: boolean;
  pending_transaction_id?: string | null;
  amount: number;
  date: string;
  merchant_name?: string | null;
  name?: string | null;
}) {
  return {
    externalId: plaidExternalId(txn.transaction_id),
    pendingExternalId: txn.pending_transaction_id
      ? plaidExternalId(txn.pending_transaction_id)
      : null,
    amountCents: plaidAmountToCents(txn.amount),
    cleared: !txn.pending,
    occurredOn: txn.date,
    payee: (txn.merchant_name || txn.name || "Bank transaction").slice(0, 200),
  };
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
): Promise<{
  inserted: number;
  updated: number;
  skippedUnmapped: number;
  pendingImported: number;
}> {
  const accountId = args.accountByPlaid.get(args.txn.account_id);
  if (!accountId) {
    return { inserted: 0, updated: 0, skippedUnmapped: 1, pendingImported: 0 };
  }

  const fields = plaidTransactionImportFields(args.txn);
  if (fields.amountCents === 0) {
    return { inserted: 0, updated: 0, skippedUnmapped: 0, pendingImported: 0 };
  }

  // Pending authorizations are imported as uncleared so recent bank activity
  // shows up immediately. When they post, Plaid usually sends a new
  // transaction_id plus pending_transaction_id pointing at the old one.
  const suggestedCategoryId = resolveCategoryFromPayeeMemory(
    fields.payee,
    args.payeeMemory,
  );
  const row = {
    user_id: args.userId,
    budget_id: args.budgetId,
    account_id: accountId,
    category_id: suggestedCategoryId,
    occurred_on: fields.occurredOn,
    payee: fields.payee,
    memo: "",
    amount_cents: fields.amountCents,
    cleared: fields.cleared,
    external_id: fields.externalId,
  };

  const { data: existingById } = await supabase
    .from("transactions")
    .select("id,amount_cents,occurred_on,payee,cleared,external_id,category_id")
    .eq("budget_id", args.budgetId)
    .eq("external_id", fields.externalId)
    .maybeSingle();

  let existing = existingById;
  // Posted txn replacing a previously imported pending authorization: keep the
  // same row (and any category the user already assigned) by rewriting external_id.
  if (!existing?.id && fields.pendingExternalId) {
    const { data: existingPending } = await supabase
      .from("transactions")
      .select("id,amount_cents,occurred_on,payee,cleared,external_id,category_id")
      .eq("budget_id", args.budgetId)
      .eq("external_id", fields.pendingExternalId)
      .maybeSingle();
    existing = existingPending;
  }

  if (existing?.id) {
    const changed =
      existing.amount_cents !== row.amount_cents ||
      existing.occurred_on !== row.occurred_on ||
      existing.payee !== row.payee ||
      existing.cleared !== fields.cleared ||
      existing.external_id !== fields.externalId;
    if (!changed) {
      return { inserted: 0, updated: 0, skippedUnmapped: 0, pendingImported: 0 };
    }
    const { error } = await supabase
      .from("transactions")
      .update({
        amount_cents: row.amount_cents,
        occurred_on: row.occurred_on,
        payee: row.payee,
        cleared: fields.cleared,
        external_id: fields.externalId,
      })
      .eq("id", existing.id);
    if (error) throw error;
    return { inserted: 0, updated: 1, skippedUnmapped: 0, pendingImported: 0 };
  }

  const { data: inserted, error } = await supabase
    .from("transactions")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    if (error.message.toLowerCase().includes("duplicate")) {
      return { inserted: 0, updated: 0, skippedUnmapped: 0, pendingImported: 0 };
    }
    throw error;
  }

  if (inserted?.id) {
    try {
      await suggestMatchForBankTransaction(supabase, {
        budgetId: args.budgetId,
        accountId,
        bankTransactionId: inserted.id,
        amountCents: fields.amountCents,
        occurredOn: fields.occurredOn,
      });
    } catch {
      // Matching is best-effort; sync should still succeed.
    }
  }

  return {
    inserted: 1,
    updated: 0,
    skippedUnmapped: 0,
    pendingImported: args.txn.pending ? 1 : 0,
  };
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
    .eq("external_id", plaidExternalId(txn.transaction_id))
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Manual "Sync now": remap accounts, ask Plaid to refresh from the bank when
 * available, then full-sync. Does not require disconnecting / re-linking.
 */
export async function manualSyncPlaidItem(
  supabase: SupabaseClient,
  item: ItemRow & { institution_name?: string | null },
): Promise<ManualSyncResult> {
  const result: ManualSyncResult = {
    ...emptySyncResult(),
    accountsLinked: 0,
    plaidAccountCount: 0,
    accountLinkErrors: [],
    refreshRequested: false,
    refreshNote: null,
    plaidLastSuccessfulUpdate: null,
  };

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
      // Best-effort status write.
    }
    return result;
  }

  try {
    const linked = await ensureLocalAccountsForItem(supabase, {
      budgetId: item.budget_id,
      userId: item.created_by,
      itemRowId: item.id,
      accessToken,
      institutionName: item.institution_name || "Linked bank",
    });
    result.accountsLinked = linked.linked;
    result.plaidAccountCount = linked.plaidAccountCount;
    result.accountLinkErrors = linked.errors;
  } catch (e) {
    // Still attempt sync with whatever accounts are already mapped.
    result.accountLinkErrors.push(
      plaidErrorMessage(e, "Could not refresh linked accounts."),
    );
  }

  try {
    const statusRes = await client.itemGet({ access_token: accessToken });
    result.plaidLastSuccessfulUpdate =
      statusRes.data.status?.transactions?.last_successful_update ?? null;
  } catch {
    // Diagnostic only.
  }

  try {
    await client.transactionsRefresh({ access_token: accessToken });
    result.refreshRequested = true;
  } catch (e) {
    const code = plaidErrorCode(e);
    // Transactions Refresh is an optional Plaid add-on; missing access is fine.
    if (
      code &&
      /PRODUCT_NOT_ENABLED|INVALID_PRODUCT|ADDITIONAL_CONSENT_REQUIRED|PRODUCTS_NOT_SUPPORTED/i.test(
        code,
      )
    ) {
      result.refreshNote =
        "On-demand bank refresh isn’t enabled on this Plaid account; synced whatever Plaid already has.";
    } else if (code) {
      result.refreshNote = plaidErrorMessage(e, "Could not request a bank refresh.");
    }
  }

  // Full replay recovers pending txns previously skipped while the cursor advanced.
  const first = await syncPlaidItem(supabase, item, { resetCursor: true });
  mergeSyncResults(result, first);

  // If Plaid accepted a refresh, give it a moment and pull incremental updates.
  if (result.refreshRequested && result.errors.length === 0) {
    await sleep(4000);
    const { data: refreshedItem } = await supabase
      .from("plaid_items")
      .select("id,budget_id,access_token_encrypted,sync_cursor,created_by")
      .eq("id", item.id)
      .eq("budget_id", item.budget_id)
      .maybeSingle();
    if (refreshedItem) {
      const second = await syncPlaidItem(supabase, refreshedItem);
      mergeSyncResults(result, second);
    }
    try {
      const statusRes = await client.itemGet({ access_token: accessToken });
      result.plaidLastSuccessfulUpdate =
        statusRes.data.status?.transactions?.last_successful_update ?? null;
    } catch {
      // Diagnostic only.
    }
  }

  // Account mapping failures are the usual reason Sync looks “successful” with
  // large skippedUnmapped counts — surface them as sync errors.
  if (result.skippedUnmapped > 0 && result.accountsLinked === 0) {
    const detail =
      result.accountLinkErrors[0] ||
      (result.plaidAccountCount === 0
        ? "Plaid returned no accounts for this connection."
        : "Could not link any Plaid accounts into this budget.");
    result.errors.push(detail);
  } else if (result.accountLinkErrors.length && result.inserted === 0) {
    result.errors.push(result.accountLinkErrors[0]!);
  }

  return result;
}

/** User-facing Settings notice after Sync now. */
export function formatManualSyncNotice(result: ManualSyncResult): string {
  if (result.errors.length) {
    const parts = [result.errors[0] || "Sync finished with errors."];
    if (result.skippedUnmapped > 0) {
      parts.push(
        `${result.skippedUnmapped} transaction${result.skippedUnmapped === 1 ? "" : "s"} could not be imported until accounts are linked.`,
      );
    }
    if (result.refreshNote) parts.push(result.refreshNote);
    return parts.join(" ");
  }

  const parts: string[] = [];
  if (result.inserted > 0) {
    parts.push(
      `Imported ${result.inserted} transaction${result.inserted === 1 ? "" : "s"}` +
        (result.pendingImported
          ? ` (${result.pendingImported} pending)`
          : ""),
    );
  } else if (result.updated > 0) {
    parts.push(
      `Updated ${result.updated} existing transaction${result.updated === 1 ? "" : "s"}; no new ones.`,
    );
  } else {
    parts.push("No new transactions from Plaid.");
  }

  if (result.accountsLinked > 0) {
    parts.push(
      `Linked ${result.accountsLinked} bank account${result.accountsLinked === 1 ? "" : "s"}.`,
    );
  }

  if (result.skippedUnmapped > 0) {
    parts.push(
      `${result.skippedUnmapped} were skipped because their bank account isn’t linked in this budget.`,
    );
  }

  if (result.plaidLastSuccessfulUpdate) {
    parts.push(
      `Plaid last received data from your bank ${new Date(result.plaidLastSuccessfulUpdate).toLocaleString()}.`,
    );
  }

  if (result.inserted === 0 && result.skippedUnmapped === 0) {
    parts.push(
      "You don’t need to disconnect — reconnecting won’t pull charges Plaid doesn’t have yet. Try Sync now again after they appear/post at your bank.",
    );
  }

  if (result.refreshNote) {
    parts.push(result.refreshNote);
  }

  return parts.join(" ");
}

/** Build the default local account name for a Plaid account. */
export function plaidAccountDisplayName(
  account: {
    name?: string | null;
    official_name?: string | null;
    type?: string | null;
    subtype?: string | null;
    mask?: string | null;
  },
  institutionName: string,
): string {
  const raw =
    account.name ||
    account.official_name ||
    `${institutionName} ${account.subtype || account.type || "account"}${
      account.mask ? ` ·${account.mask}` : ""
    }`;
  return raw.slice(0, 80);
}

/**
 * Prefer an existing unmapped local account when Plaid reconnects or mappings
 * were deleted (unique account names would otherwise block re-create).
 */
export function pickReusableLocalAccount(
  localAccounts: Array<{ id: string; name: string; account_type: string }>,
  mappedAccountIds: Set<string>,
  opts: { name: string; accountType: string; mask?: string | null },
): string | null {
  const wantName = opts.name.trim().toLowerCase();
  const unmapped = localAccounts.filter((a) => !mappedAccountIds.has(a.id));

  const exact = unmapped.find((a) => a.name.trim().toLowerCase() === wantName);
  if (exact) return exact.id;

  const mask = opts.mask?.replace(/\D/g, "");
  if (mask) {
    const byMask = unmapped.find((a) => a.name.includes(mask));
    if (byMask) return byMask.id;
  }

  const sameType = unmapped.filter((a) => a.account_type === opts.accountType);
  if (sameType.length === 1) return sameType[0]!.id;

  // Last resort: already-mapped account with the exact same name (remap).
  const mappedExact = localAccounts.find(
    (a) => a.name.trim().toLowerCase() === wantName,
  );
  return mappedExact?.id ?? null;
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
): Promise<EnsureAccountsResult> {
  const client = getPlaidClient();
  const accountsRes = await client.accountsGet({ access_token: args.accessToken });
  const plaidAccounts = accountsRes.data.accounts ?? [];
  const result: EnsureAccountsResult = {
    linked: 0,
    plaidAccountCount: plaidAccounts.length,
    errors: [],
  };

  if (plaidAccounts.length === 0) {
    result.errors.push("Plaid returned no accounts for this connection.");
    return result;
  }

  const { data: localAccounts, error: localErr } = await supabase
    .from("accounts")
    .select("id,name,account_type")
    .eq("budget_id", args.budgetId);
  if (localErr) {
    result.errors.push(localErr.message);
    return result;
  }

  const { data: existingMaps, error: mapErr } = await supabase
    .from("plaid_accounts")
    .select("id,plaid_account_id,account_id")
    .eq("budget_id", args.budgetId);
  if (mapErr) {
    result.errors.push(mapErr.message);
    return result;
  }

  const mapByPlaidId = new Map(
    (existingMaps ?? []).map((m) => [
      m.plaid_account_id as string,
      m.account_id as string,
    ]),
  );
  const mappedAccountIds = new Set(
    (existingMaps ?? []).map((m) => m.account_id as string),
  );
  const locals = (localAccounts ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    account_type: a.account_type as string,
  }));

  const { data: maxSort } = await supabase
    .from("accounts")
    .select("sort_order")
    .eq("budget_id", args.budgetId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextSortOrder = Number(maxSort?.sort_order ?? -1) + 1;

  for (const account of plaidAccounts) {
    const accountType = mapPlaidAccountType(account.type, account.subtype);
    const name = plaidAccountDisplayName(account, args.institutionName);
    let accountId = mapByPlaidId.get(account.account_id);

    if (!accountId) {
      accountId =
        pickReusableLocalAccount(locals, mappedAccountIds, {
          name,
          accountType,
          mask: account.mask,
        }) ?? undefined;
    }

    if (!accountId) {
      const baseRow = {
        user_id: args.userId,
        budget_id: args.budgetId,
        name,
        account_type: accountType,
        currency: (account.balances.iso_currency_code || "USD").toUpperCase(),
      };

      let created: { id: string } | null = null;
      let error: { message: string; code?: string } | null = null;
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

      // Name already taken: reuse that local account instead of failing open.
      if (error && /duplicate|unique/i.test(error.message)) {
        const reused = pickReusableLocalAccount(locals, new Set(), {
          name,
          accountType,
          mask: account.mask,
        });
        if (reused) {
          accountId = reused;
          error = null;
        } else {
          const suffixName = `${name.slice(0, 60)} (${account.account_id.slice(-6)})`;
          ({ data: created, error } = await supabase
            .from("accounts")
            .insert({
              ...baseRow,
              name: suffixName,
              include_in_total: true,
              sort_order: nextSortOrder,
            })
            .select("id")
            .single());
        }
      }

      if (!accountId && created?.id) {
        accountId = created.id;
        locals.push({ id: created.id, name: baseRow.name, account_type: accountType });
        nextSortOrder += 1;
      }

      if (!accountId) {
        result.errors.push(
          `Could not create account “${name}”: ${error?.message || "unknown error"}`,
        );
        continue;
      }
    }

    const { error: upsertErr } = await supabase.from("plaid_accounts").upsert(
      {
        budget_id: args.budgetId,
        plaid_item_id: args.itemRowId,
        plaid_account_id: account.account_id,
        account_id: accountId,
      },
      { onConflict: "budget_id,plaid_account_id" },
    );
    if (upsertErr) {
      // unique(account_id) can block if this local account is already mapped to
      // a different Plaid account — clear the stale map and retry once.
      if (/duplicate|unique/i.test(upsertErr.message)) {
        await supabase
          .from("plaid_accounts")
          .delete()
          .eq("budget_id", args.budgetId)
          .eq("account_id", accountId)
          .neq("plaid_account_id", account.account_id);
        const { error: retryErr } = await supabase.from("plaid_accounts").upsert(
          {
            budget_id: args.budgetId,
            plaid_item_id: args.itemRowId,
            plaid_account_id: account.account_id,
            account_id: accountId,
          },
          { onConflict: "budget_id,plaid_account_id" },
        );
        if (retryErr) {
          result.errors.push(
            `Could not link “${name}”: ${retryErr.message}`,
          );
          continue;
        }
      } else {
        result.errors.push(`Could not link “${name}”: ${upsertErr.message}`);
        continue;
      }
    }

    mapByPlaidId.set(account.account_id, accountId);
    mappedAccountIds.add(accountId);
    result.linked += 1;
  }

  if (result.linked === 0 && result.errors.length === 0) {
    result.errors.push("Could not link any Plaid accounts into this budget.");
  }

  return result;
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

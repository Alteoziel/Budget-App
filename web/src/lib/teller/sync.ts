import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listTellerTransactions,
  tellerAmountToCents,
  type TellerTransaction,
} from "@/lib/teller/client";
import { decryptSecret } from "@/lib/teller/crypto";

export type SyncResult = {
  inserted: number;
  updated: number;
  errors: string[];
};

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function syncEnrollment(
  supabase: SupabaseClient,
  enrollmentRow: {
    id: string;
    budget_id: string;
    access_token_encrypted: string;
    last_synced_at: string | null;
    created_by: string;
  },
  opts?: { backfillDays?: number },
): Promise<SyncResult> {
  const result: SyncResult = { inserted: 0, updated: 0, errors: [] };
  const accessToken = decryptSecret(enrollmentRow.access_token_encrypted);

  const { data: maps, error: mapErr } = await supabase
    .from("teller_accounts")
    .select("teller_account_id,account_id")
    .eq("enrollment_id", enrollmentRow.id);

  if (mapErr) {
    result.errors.push(mapErr.message);
    return result;
  }

  const startDate = enrollmentRow.last_synced_at
    ? daysAgoIso(10) // overlap window for pending→posted date shifts
    : daysAgoIso(opts?.backfillDays ?? 90);

  for (const map of maps ?? []) {
    try {
      const txns = await listTellerTransactions(
        accessToken,
        map.teller_account_id as string,
        { startDate },
      );
      const counts = await upsertTellerTransactions(supabase, {
        budgetId: enrollmentRow.budget_id,
        userId: enrollmentRow.created_by,
        accountId: map.account_id as string,
        txns,
      });
      result.inserted += counts.inserted;
      result.updated += counts.updated;
    } catch (e) {
      result.errors.push(
        e instanceof Error ? e.message : `Sync failed for ${map.teller_account_id}`,
      );
    }
  }

  await supabase
    .from("teller_enrollments")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: result.errors.length ? result.errors.join("; ").slice(0, 1000) : null,
      status: result.errors.length ? "error" : "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", enrollmentRow.id);

  return result;
}

export async function upsertTellerTransactions(
  supabase: SupabaseClient,
  args: {
    budgetId: string;
    userId: string;
    accountId: string;
    txns: TellerTransaction[];
  },
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const txn of args.txns) {
    if (txn.status === "pending") continue;
    const amountCents = tellerAmountToCents(txn.amount);
    if (amountCents === 0) continue;

    const externalId = `teller:${txn.id}`;
    const row = {
      user_id: args.userId,
      budget_id: args.budgetId,
      account_id: args.accountId,
      category_id: null as string | null,
      occurred_on: txn.date,
      payee: txn.description?.slice(0, 200) || "Bank transaction",
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
      if (changed) {
        const { error } = await supabase
          .from("transactions")
          .update({
            amount_cents: row.amount_cents,
            occurred_on: row.occurred_on,
            payee: row.payee,
            cleared: true,
          })
          .eq("id", existing.id);
        if (!error) updated += 1;
      }
    } else {
      const { error } = await supabase.from("transactions").insert(row);
      if (!error) inserted += 1;
      else if (!error.message.toLowerCase().includes("duplicate")) {
        throw error;
      }
    }
  }

  return { inserted, updated };
}

export async function syncAllActiveEnrollments(
  supabase: SupabaseClient,
): Promise<{ runs: number; inserted: number; updated: number; errors: string[] }> {
  const { data: enrollments, error } = await supabase
    .from("teller_enrollments")
    .select("id,budget_id,access_token_encrypted,last_synced_at,created_by,status")
    .neq("status", "disconnected");

  if (error) throw new Error(error.message);

  let inserted = 0;
  let updated = 0;
  const errors: string[] = [];
  let runs = 0;

  for (const enrollment of enrollments ?? []) {
    runs += 1;
    const started = new Date().toISOString();
    const result = await syncEnrollment(supabase, enrollment);
    inserted += result.inserted;
    updated += result.updated;
    if (result.errors.length) errors.push(...result.errors);

    await supabase.from("sync_runs").insert({
      budget_id: enrollment.budget_id,
      enrollment_id: enrollment.id,
      source: "cron",
      started_at: started,
      finished_at: new Date().toISOString(),
      inserted: result.inserted,
      updated: result.updated,
      errors: result.errors.length ? result.errors.join("\n").slice(0, 4000) : null,
    });
  }

  return { runs, inserted, updated, errors };
}

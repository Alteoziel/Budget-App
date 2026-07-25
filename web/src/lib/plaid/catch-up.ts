import { createServiceClient } from "@/lib/supabase/admin";
import { plaidConfigured } from "@/lib/plaid/client";
import { isPlaidSyncStale } from "@/lib/plaid/cron-auth";
import { syncAllActivePlaidItems } from "@/lib/plaid/sync";

/** If last sync is older than this, opening the app triggers a catch-up. */
export const PLAID_CATCHUP_STALE_MS = 16 * 60 * 60 * 1000;

/** Skip catch-up when another sync started this recently (stampede guard). */
export const PLAID_CATCHUP_DEBOUNCE_MS = 10 * 60 * 1000;

/**
 * Sync stale Plaid items for one budget. Safe to call from `after()` —
 * never throws to the caller’s request path.
 */
export async function catchUpStalePlaidSyncForBudget(budgetId: string): Promise<{
  skipped: boolean;
  reason?: string;
  runs?: number;
  inserted?: number;
  updated?: number;
  errors?: string[];
}> {
  if (!budgetId) return { skipped: true, reason: "No budget" };
  if (!plaidConfigured()) {
    return { skipped: true, reason: "Plaid not configured" };
  }

  try {
    const supabase = createServiceClient();

    const { data: recent, error: recentError } = await supabase
      .from("sync_runs")
      .select("id,started_at")
      .eq("budget_id", budgetId)
      .gte(
        "started_at",
        new Date(Date.now() - PLAID_CATCHUP_DEBOUNCE_MS).toISOString(),
      )
      .limit(1);
    if (recentError) {
      console.error("[plaid-catchup] recent check failed", recentError.message);
      return { skipped: true, reason: recentError.message };
    }
    if (recent && recent.length > 0) {
      return { skipped: true, reason: "Recent sync already in progress or finished" };
    }

    const { data: items, error: itemsError } = await supabase
      .from("plaid_items")
      .select("id,last_synced_at,status")
      .eq("budget_id", budgetId)
      .neq("status", "disconnected");
    if (itemsError) {
      console.error("[plaid-catchup] items load failed", itemsError.message);
      return { skipped: true, reason: itemsError.message };
    }

    const staleIds = (items ?? [])
      .filter((item) => isPlaidSyncStale(item.last_synced_at as string | null, PLAID_CATCHUP_STALE_MS))
      .map((item) => item.id as string);

    if (staleIds.length === 0) {
      return { skipped: true, reason: "Bank connections are fresh" };
    }

    console.info("[plaid-catchup] syncing stale items", {
      budgetId,
      count: staleIds.length,
    });

    const result = await syncAllActivePlaidItems(supabase, {
      source: "catchup",
      budgetId,
      itemIds: staleIds,
      retries: 1,
    });

    console.info("[plaid-catchup] done", {
      budgetId,
      runs: result.runs,
      inserted: result.inserted,
      updated: result.updated,
      errors: result.errors.length,
    });

    return {
      skipped: false,
      runs: result.runs,
      inserted: result.inserted,
      updated: result.updated,
      errors: result.errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Catch-up failed";
    console.error("[plaid-catchup] fatal", message);
    return { skipped: true, reason: message };
  }
}

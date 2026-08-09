import { createServiceClient } from "@/lib/supabase/admin";
import { plaidConfigured } from "@/lib/plaid/client";
import { isPlaidSyncStale } from "@/lib/plaid/cron-auth";
import {
  formatOpenSyncNotice,
  PLAID_OPEN_SYNC_DEBOUNCE_MS,
} from "@/lib/plaid/open-sync";
import {
  formatManualSyncNotice,
  manualSyncPlaidItem,
  syncAllActivePlaidItems,
  type ManualSyncResult,
} from "@/lib/plaid/sync";

export {
  formatOpenSyncNotice,
  PLAID_OPEN_SYNC_DEBOUNCE_MS,
} from "@/lib/plaid/open-sync";

/** If last sync is older than this, opening the app triggers a catch-up. */
export const PLAID_CATCHUP_STALE_MS = 16 * 60 * 60 * 1000;

/** Skip catch-up when another sync started this recently (stampede guard). */
export const PLAID_CATCHUP_DEBOUNCE_MS = 10 * 60 * 1000;

export type ForceSyncPlaidResult = {
  skipped: boolean;
  reason?: string;
  runs?: number;
  inserted?: number;
  updated?: number;
  errors?: string[];
  /** Short user-facing status for the open-app toast. */
  notice?: string;
};

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

/**
 * Force a manual-style bank sync for every connected item in the budget.
 * Same path as Settings → Sync now (remap + refresh + full sync), but for
 * open-app / resume without redirects.
 */
export async function forceSyncPlaidForBudget(
  budgetId: string,
): Promise<ForceSyncPlaidResult> {
  if (!budgetId) {
    return {
      skipped: true,
      reason: "No budget",
      notice: formatOpenSyncNotice({ skipped: true, reason: "No budget" }),
    };
  }
  if (!plaidConfigured()) {
    return {
      skipped: true,
      reason: "Plaid not configured",
      notice: formatOpenSyncNotice({ skipped: true, reason: "Plaid not configured" }),
    };
  }

  try {
    const supabase = createServiceClient();

    const { data: recent, error: recentError } = await supabase
      .from("sync_runs")
      .select("id,started_at")
      .eq("budget_id", budgetId)
      .gte(
        "started_at",
        new Date(Date.now() - PLAID_OPEN_SYNC_DEBOUNCE_MS).toISOString(),
      )
      .limit(1);
    if (recentError) {
      console.error("[plaid-open-sync] recent check failed", recentError.message);
      return {
        skipped: true,
        reason: recentError.message,
        notice: formatOpenSyncNotice({ skipped: true, reason: recentError.message }),
      };
    }
    if (recent && recent.length > 0) {
      return {
        skipped: true,
        reason: "Recent sync already in progress or finished",
        notice: formatOpenSyncNotice({
          skipped: true,
          reason: "Recent sync already in progress or finished",
        }),
      };
    }

    const { data: items, error: itemsError } = await supabase
      .from("plaid_items")
      .select(
        "id,budget_id,access_token_encrypted,sync_cursor,created_by,status,institution_name",
      )
      .eq("budget_id", budgetId)
      .neq("status", "disconnected");
    if (itemsError) {
      console.error("[plaid-open-sync] items load failed", itemsError.message);
      return {
        skipped: true,
        reason: itemsError.message,
        notice: formatOpenSyncNotice({ skipped: true, reason: itemsError.message }),
      };
    }

    if (!items?.length) {
      return {
        skipped: true,
        reason: "No bank connections",
        notice: formatOpenSyncNotice({
          skipped: true,
          reason: "No bank connections",
        }),
      };
    }

    console.info("[plaid-open-sync] forcing manual sync", {
      budgetId,
      count: items.length,
    });

    let inserted = 0;
    let updated = 0;
    let runs = 0;
    const errors: string[] = [];
    const notices: string[] = [];

    for (const item of items) {
      runs += 1;
      const started = new Date().toISOString();
      const result: ManualSyncResult = await manualSyncPlaidItem(supabase, item);
      inserted += result.inserted;
      updated += result.updated;
      if (result.errors.length) {
        errors.push(
          `[${item.institution_name || item.id}] ${result.errors.join("; ")}`,
        );
      } else {
        notices.push(formatManualSyncNotice(result));
      }

      const runRow = {
        budget_id: budgetId,
        plaid_item_id: item.id,
        started_at: started,
        finished_at: new Date().toISOString(),
        inserted: result.inserted,
        updated: result.updated,
        errors: result.errors.length
          ? result.errors.join("\n").slice(0, 4000)
          : null,
      };
      // Prefer source=open; fall back to manual if the open-source migration
      // hasn't been applied yet so sync still completes.
      const openRun = await supabase
        .from("sync_runs")
        .insert({ ...runRow, source: "open" });
      if (openRun.error) {
        await supabase.from("sync_runs").insert({ ...runRow, source: "manual" });
      }
    }

    const summary = {
      skipped: false as const,
      runs,
      inserted,
      updated,
      errors,
      notice: formatOpenSyncNotice({ inserted, updated, errors }),
    };

    console.info("[plaid-open-sync] done", {
      budgetId,
      runs,
      inserted,
      updated,
      errors: errors.length,
    });

    // Prefer the compact toast notice; keep a longer trail in logs only.
    if (notices.length) {
      console.info("[plaid-open-sync] detail", notices.join(" | "));
    }

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Open sync failed";
    console.error("[plaid-open-sync] fatal", message);
    return {
      skipped: true,
      reason: message,
      notice: formatOpenSyncNotice({ skipped: true, reason: message }),
    };
  }
}

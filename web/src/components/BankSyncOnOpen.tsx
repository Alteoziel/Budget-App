"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNotifyBudgetChange } from "@/components/BudgetRealtimeProvider";
import { syncPlaidOnOpenAction } from "@/lib/actions";
import { PLAID_OPEN_SYNC_DEBOUNCE_MS } from "@/lib/plaid/open-sync";

type SyncStatus = "idle" | "syncing" | "done" | "error";

const CLIENT_DEBOUNCE_KEY = "alte-plaid-open-sync-at";

function readLastClientSyncAt(budgetId: string): number {
  try {
    const raw = sessionStorage.getItem(`${CLIENT_DEBOUNCE_KEY}:${budgetId}`);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeLastClientSyncAt(budgetId: string, at: number) {
  try {
    sessionStorage.setItem(`${CLIENT_DEBOUNCE_KEY}:${budgetId}`, String(at));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

/**
 * Forces a manual-style Plaid sync when the app opens or returns to the
 * foreground, then refreshes RSC data so the UI isn’t stuck on a stale paint.
 */
export function BankSyncOnOpen({
  budgetId,
  enabled,
}: {
  budgetId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const notifyChange = useNotifyBudgetChange();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const hideTimer = useRef<number | null>(null);

  const runSync = useCallback(
    async (reason: "mount" | "resume") => {
      if (!enabled || !budgetId || inFlight.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      const now = Date.now();
      const last = readLastClientSyncAt(budgetId);
      if (now - last < PLAID_OPEN_SYNC_DEBOUNCE_MS) return;

      inFlight.current = true;
      writeLastClientSyncAt(budgetId, now);
      setStatus("syncing");
      setMessage(reason === "resume" ? "Refreshing bank…" : "Syncing with bank…");

      if (hideTimer.current != null) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }

      try {
        const result = await syncPlaidOnOpenAction();
        const notice = result.notice || "Bank sync finished";
        setMessage(notice);

        if (result.skipped && result.reason === "No bank connections") {
          setStatus("idle");
          setMessage(null);
          return;
        }

        if (result.errors?.length) {
          setStatus("error");
        } else {
          setStatus("done");
        }

        // Refresh after open sync so first paint can’t stay stale when
        // Realtime lags or isn’t subscribed yet.
        if (!result.skipped) {
          notifyChange();
          router.refresh();
        } else if (result.reason === "Recent sync already in progress or finished") {
          // Another path may have written rows; pull latest UI anyway.
          router.refresh();
        }
      } catch {
        setStatus("error");
        setMessage("Couldn’t reach the bank just now");
      } finally {
        inFlight.current = false;
        hideTimer.current = window.setTimeout(() => {
          setStatus("idle");
          setMessage(null);
          hideTimer.current = null;
        }, 4200);
      }
    },
    [budgetId, enabled, notifyChange, router],
  );

  useEffect(() => {
    // Defer so the effect itself doesn’t synchronously setState (lint + paint).
    const bootTimer = window.setTimeout(() => {
      void runSync("mount");
    }, 0);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void runSync("resume");
      }
    };
    const onFocus = () => {
      void runSync("resume");
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(bootTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      if (hideTimer.current != null) {
        window.clearTimeout(hideTimer.current);
      }
    };
  }, [runSync]);

  if (status === "idle" || !message) return null;

  const tone =
    status === "error"
      ? "border-coral-400/40 bg-coral-400/15 text-coral-700"
      : status === "syncing"
        ? "border-moss-400/35 bg-moss-500/10 text-ink-800"
        : "border-moss-400/40 bg-moss-500/15 text-ink-900";

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 lg:bottom-6"
      role="status"
      aria-live="polite"
    >
      <div
        className={`animate-rise max-w-sm rounded-2xl border px-3.5 py-2.5 text-center text-xs font-bold shadow-soft backdrop-blur-sm ${tone}`}
      >
        {status === "syncing" ? (
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-moss-500"
              aria-hidden
            />
            {message}
          </span>
        ) : (
          message
        )}
      </div>
    </div>
  );
}

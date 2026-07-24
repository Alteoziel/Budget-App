"use client";

import Link from "next/link";
import { useOffline } from "@/components/OfflineProvider";

export function OfflineBanner() {
  const { online, snapshot, outboxCount, flushOutbox } = useOffline();

  if (online && outboxCount === 0) return null;

  if (!online) {
    return (
      <div className="mb-4 rounded-2xl border border-coral-400/40 bg-coral-400/15 px-4 py-3">
        <p className="text-sm font-bold text-coral-600">You’re offline</p>
        <p className="mt-1 text-xs text-ink-700">
          {snapshot
            ? `Showing your last synced snapshot from ${new Date(snapshot.savedAt).toLocaleString()}.`
            : "Open Budget or Accounts once while online to save a snapshot for airplane mode."}
        </p>
        <Link
          href="/offline"
          className="mt-2 inline-flex min-h-11 items-center text-xs font-bold text-moss-500"
        >
          Open cached budget →
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-moss-400/40 bg-moss-500/10 px-4 py-3">
      <p className="text-sm font-bold text-ink-900">
        {outboxCount} offline change{outboxCount === 1 ? "" : "s"} waiting to sync
      </p>
      <button
        type="button"
        onClick={() => {
          void flushOutbox();
        }}
        className="mt-2 min-h-11 text-xs font-bold text-moss-500"
      >
        Sync now
      </button>
    </div>
  );
}

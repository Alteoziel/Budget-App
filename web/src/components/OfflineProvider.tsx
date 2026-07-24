"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  enqueueOutboxItem,
  listOutbox,
  readOfflineSnapshot,
  removeOutboxItem,
  saveOfflineSnapshot,
} from "@/lib/offline/db";
import type { OfflineOutboxItem, OfflineSnapshot } from "@/lib/offline/types";

type OfflineContextValue = {
  online: boolean;
  snapshot: OfflineSnapshot | null;
  outboxCount: number;
  refreshSnapshot: () => Promise<void>;
  queueTransaction: (
    payload: OfflineOutboxItem["payload"],
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  flushOutbox: () => Promise<{ applied: number; failed: number }>;
};

const OfflineContext = createContext<OfflineContextValue | null>(null);

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function getOnlineSnapshot() {
  return navigator.onLine;
}

function getOnlineServerSnapshot() {
  return true;
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const online = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getOnlineServerSnapshot,
  );
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [outboxCount, setOutboxCount] = useState(0);

  const refreshOutboxCount = useCallback(async () => {
    try {
      const items = await listOutbox();
      setOutboxCount(items.length);
    } catch {
      setOutboxCount(0);
    }
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!navigator.onLine) {
      const local = await readOfflineSnapshot();
      setSnapshot(local);
      return;
    }
    try {
      const response = await fetch("/api/offline/snapshot", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        const local = await readOfflineSnapshot();
        setSnapshot(local);
        return;
      }
      const data = (await response.json()) as OfflineSnapshot;
      await saveOfflineSnapshot(data);
      setSnapshot(data);
    } catch {
      const local = await readOfflineSnapshot();
      setSnapshot(local);
    }
  }, []);

  const flushOutbox = useCallback(async () => {
    if (!navigator.onLine) return { applied: 0, failed: 0 };
    const items = await listOutbox();
    if (!items.length) return { applied: 0, failed: 0 };

    const response = await fetch("/api/offline/sync", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!response.ok) return { applied: 0, failed: items.length };

    const result = (await response.json()) as {
      applied?: string[];
      failed?: Array<{ id: string; error: string }>;
    };

    for (const id of result.applied ?? []) {
      await removeOutboxItem(id);
    }
    await refreshOutboxCount();
    if ((result.applied ?? []).length) {
      await refreshSnapshot();
    }
    return {
      applied: result.applied?.length ?? 0,
      failed: result.failed?.length ?? 0,
    };
  }, [refreshOutboxCount, refreshSnapshot]);

  const queueTransaction = useCallback(
    async (payload: OfflineOutboxItem["payload"]) => {
      try {
        await enqueueOutboxItem({ kind: "create_transaction", payload });
        await refreshOutboxCount();
        return { ok: true as const };
      } catch {
        return {
          ok: false as const,
          error: "Could not save this offline. Try again when you’re online.",
        };
      }
    },
    [refreshOutboxCount],
  );

  useEffect(() => {
    let cancelled = false;
    const boot = window.setTimeout(() => {
      void (async () => {
        const local = await readOfflineSnapshot();
        if (cancelled) return;
        setSnapshot(local);
        await refreshOutboxCount();
        if (!navigator.onLine || cancelled) return;
        await refreshSnapshot();
        await flushOutbox();
        // Warm the Offline page in the service-worker page cache.
        void fetch("/offline", {
          credentials: "same-origin",
          headers: { Accept: "text/html" },
        });
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(boot);
    };
  }, [flushOutbox, refreshOutboxCount, refreshSnapshot]);

  useEffect(() => {
    if (!online) return;
    const id = window.setTimeout(() => {
      void flushOutbox();
      void refreshSnapshot();
    }, 0);
    return () => window.clearTimeout(id);
  }, [online, flushOutbox, refreshSnapshot]);

  // Refresh the local cache after normal navigations while online.
  useEffect(() => {
    if (!online) return;
    const onFocus = () => {
      void refreshSnapshot();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [online, refreshSnapshot]);

  const value = useMemo(
    () => ({
      online,
      snapshot,
      outboxCount,
      refreshSnapshot,
      queueTransaction,
      flushOutbox,
    }),
    [online, snapshot, outboxCount, refreshSnapshot, queueTransaction, flushOutbox],
  );

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  );
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) {
    throw new Error("useOffline must be used within OfflineProvider");
  }
  return ctx;
}

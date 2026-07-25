"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type PresenceEditing = {
  kind: "category" | "group" | "transaction" | "account" | "goal";
  id: string;
  label: string;
} | null;

export type BudgetPeer = {
  userId: string;
  displayName: string;
  path: string;
  editing: PresenceEditing;
  onlineAt: string;
};

type PresencePayload = {
  userId: string;
  displayName: string;
  path: string;
  editing: PresenceEditing;
  onlineAt: string;
};

type BudgetRealtimeContextValue = {
  peers: BudgetPeer[];
  setEditing: (editing: PresenceEditing) => void;
  live: boolean;
};

const BudgetRealtimeContext = createContext<BudgetRealtimeContextValue>({
  peers: [],
  setEditing: () => {},
  live: false,
});

const LIVE_TABLES = [
  "transactions",
  "categories",
  "category_groups",
  "category_months",
  "accounts",
] as const;

function peersFromPresenceState(
  state: Record<string, PresencePayload[]>,
  selfUserId: string,
): BudgetPeer[] {
  const byUser = new Map<string, BudgetPeer>();
  for (const payloads of Object.values(state)) {
    for (const payload of payloads) {
      if (!payload?.userId || payload.userId === selfUserId) continue;
      const existing = byUser.get(payload.userId);
      if (!existing || payload.onlineAt > existing.onlineAt) {
        byUser.set(payload.userId, {
          userId: payload.userId,
          displayName: payload.displayName || "Teammate",
          path: payload.path || "/budget",
          editing: payload.editing ?? null,
          onlineAt: payload.onlineAt,
        });
      }
    }
  }
  return [...byUser.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

export function BudgetRealtimeProvider({
  budgetId,
  userId,
  displayName,
  children,
}: {
  budgetId: string;
  userId: string;
  displayName: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() || "/budget";
  const [peers, setPeers] = useState<BudgetPeer[]>([]);
  const [live, setLive] = useState(false);
  const [editing, setEditingState] = useState<PresenceEditing>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimer = useRef<number | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current != null) {
      window.clearTimeout(refreshTimer.current);
    }
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, 250);
  }, [router]);

  const setEditing = useCallback((next: PresenceEditing) => {
    setEditingState(next);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`budget-live:${budgetId}`, {
      config: { presence: { key: userId } },
    });
    channelRef.current = channel;

    for (const table of LIVE_TABLES) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `budget_id=eq.${budgetId}`,
        },
        () => {
          scheduleRefresh();
        },
      );
    }

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresencePayload>();
        setPeers(peersFromPresenceState(state, userId));
      })
      .on("presence", { event: "join" }, () => {
        const state = channel.presenceState<PresencePayload>();
        setPeers(peersFromPresenceState(state, userId));
      })
      .on("presence", { event: "leave" }, () => {
        const state = channel.presenceState<PresencePayload>();
        setPeers(peersFromPresenceState(state, userId));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setLive(true);
          await channel.track({
            userId,
            displayName: displayName || "You",
            path: "/budget",
            editing: null,
            onlineAt: new Date().toISOString(),
          } satisfies PresencePayload);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setLive(false);
        }
      });

    return () => {
      if (refreshTimer.current != null) {
        window.clearTimeout(refreshTimer.current);
      }
      setLive(false);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [budgetId, userId, displayName, scheduleRefresh]);

  // Keep presence payload fresh when route or editing focus changes.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !live) return;
    void channel.track({
      userId,
      displayName: displayName || "You",
      path: pathname,
      editing,
      onlineAt: new Date().toISOString(),
    } satisfies PresencePayload);
  }, [pathname, editing, live, userId, displayName]);

  const value = useMemo(
    () => ({ peers, setEditing, live }),
    [peers, setEditing, live],
  );

  return (
    <BudgetRealtimeContext.Provider value={value}>
      {children}
    </BudgetRealtimeContext.Provider>
  );
}

export function useBudgetRealtime() {
  return useContext(BudgetRealtimeContext);
}

/** Announce that this client is editing something (clears on unmount/close). */
export function useAnnounceEditing(editing: PresenceEditing) {
  const { setEditing } = useBudgetRealtime();
  const kind = editing?.kind ?? null;
  const id = editing?.id ?? null;
  const label = editing?.label ?? null;

  useEffect(() => {
    if (!kind || !id || !label) {
      setEditing(null);
      return () => setEditing(null);
    }
    setEditing({ kind, id, label });
    return () => setEditing(null);
  }, [kind, id, label, setEditing]);
}

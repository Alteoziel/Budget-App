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
  /** Tell other clients on this budget to refresh (broadcast + local signal). */
  notifyChange: () => void;
};

const BudgetRealtimeContext = createContext<BudgetRealtimeContextValue>({
  peers: [],
  setEditing: () => {},
  live: false,
  notifyChange: () => {},
});

const LIVE_TABLES = [
  "transactions",
  "categories",
  "category_groups",
  "category_months",
  "accounts",
] as const;

const BUDGET_CHANGED_EVENT = "alte:budget-changed";
const PEER_POLL_MS = 6_000;

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
  const lastLocalNotify = useRef(0);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current != null) {
      window.clearTimeout(refreshTimer.current);
    }
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, 200);
  }, [router]);

  const setEditing = useCallback((next: PresenceEditing) => {
    setEditingState(next);
  }, []);

  const notifyChange = useCallback(() => {
    lastLocalNotify.current = Date.now();
    const channel = channelRef.current;
    if (channel) {
      void channel.send({
        type: "broadcast",
        event: "budget-changed",
        payload: {
          budgetId,
          userId,
          at: new Date().toISOString(),
        },
      });
    }
    // Let any local listeners know too (same-tab helpers).
    window.dispatchEvent(new CustomEvent(BUDGET_CHANGED_EVENT));
  }, [budgetId, userId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`budget-live:${budgetId}`, {
      config: {
        presence: { key: userId },
        broadcast: { self: false },
      },
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
          // Skip echo right after our own notify (local page already refreshed).
          if (Date.now() - lastLocalNotify.current < 800) return;
          scheduleRefresh();
        },
      );
    }

    channel.on("broadcast", { event: "budget-changed" }, (message) => {
      const fromUser = String(
        (message?.payload as { userId?: string } | undefined)?.userId ?? "",
      );
      if (fromUser && fromUser === userId) return;
      scheduleRefresh();
    });

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

  // Safety net: while collaborators are present, poll for changes in case
  // postgres_changes isn't enabled yet on the project.
  useEffect(() => {
    if (!live || peers.length === 0) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastLocalNotify.current < 1_500) return;
      scheduleRefresh();
    }, PEER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, peers.length, scheduleRefresh]);

  const value = useMemo(
    () => ({ peers, setEditing, live, notifyChange }),
    [peers, setEditing, live, notifyChange],
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

/** Call after a successful local mutation so other clients refresh promptly. */
export function useNotifyBudgetChange() {
  const { notifyChange } = useBudgetRealtime();
  return notifyChange;
}

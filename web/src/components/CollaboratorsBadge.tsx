"use client";

import { useBudgetRealtime } from "@/components/BudgetRealtimeProvider";

export function CollaboratorsBadge() {
  const { peers, live } = useBudgetRealtime();

  if (!live) return null;

  const count = peers.length + 1;

  return (
    <p
      className="text-[11px] font-semibold text-ink-500"
      title="Shared budget updates sync live while people are here"
    >
      Live · {count}
    </p>
  );
}

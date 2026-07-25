"use client";

import { useBudgetRealtime } from "@/components/BudgetRealtimeProvider";

function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function pathLabel(path: string) {
  if (path.startsWith("/budget")) return "Budget";
  if (path.startsWith("/accounts/")) return "Account";
  if (path.startsWith("/accounts")) return "Accounts";
  if (path.startsWith("/transactions")) return "Transactions";
  if (path.startsWith("/insights")) return "Insights";
  if (path.startsWith("/settings")) return "Settings";
  return "App";
}

export function CollaboratorsBadge() {
  const { peers, live } = useBudgetRealtime();

  if (!live && peers.length === 0) return null;

  return (
    <div className="flex max-w-[14rem] flex-col items-end gap-1 sm:max-w-xs">
      {peers.length === 0 ? (
        <p className="text-[11px] font-semibold text-ink-500">
          Live · only you
        </p>
      ) : (
        <>
          <ul className="flex flex-wrap justify-end gap-1">
            {peers.map((peer) => (
              <li key={peer.userId}>
                <span
                  title={
                    peer.editing
                      ? `${peer.displayName} editing ${peer.editing.label}`
                      : `${peer.displayName} on ${pathLabel(peer.path)}`
                  }
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-moss-500/15 px-2 py-1 text-[11px] font-bold text-moss-700 ring-1 ring-moss-500/25"
                >
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-moss-500 text-[10px] text-sand-50">
                    {shortName(peer.displayName)}
                  </span>
                  <span className="max-w-[6.5rem] truncate">{peer.displayName}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] font-semibold text-ink-500">
            {peers.some((p) => p.editing)
              ? peers
                  .filter((p) => p.editing)
                  .map((p) => `${p.displayName}: ${p.editing!.label}`)
                  .join(" · ")
              : `Live · ${peers.length + 1} here`}
          </p>
        </>
      )}
    </div>
  );
}

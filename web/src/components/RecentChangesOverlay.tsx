"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { undoBudgetChangeAction } from "@/lib/actions";
import type { BudgetChangeLogRow } from "@/lib/change-log";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";

function entityLabel(type: BudgetChangeLogRow["entity_type"]) {
  switch (type) {
    case "transaction":
      return "Transaction";
    case "account":
      return "Account";
    case "category":
      return "Category";
    case "category_group":
      return "Group";
    default:
      return "Change";
  }
}

function daysLeft(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days === 1 ? "1 day left" : `${days} days left`;
}

export function RecentChangesOverlay({
  changes,
  defaultOpen = false,
}: {
  changes: BudgetChangeLogRow[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const panel =
    open && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[80] flex justify-end bg-ink-900/45 backdrop-blur-[2px]">
            <button
              type="button"
              aria-label="Close recent changes"
              className="absolute inset-0"
              onClick={() => setOpen(false)}
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="relative z-10 flex h-full w-full max-w-lg flex-col bg-sand-50 shadow-xl ring-1 ring-ink-900/10"
            >
              <div className="flex items-start justify-between gap-3 border-b border-ink-900/10 px-4 py-4">
                <div className="min-w-0">
                  <h2
                    id={titleId}
                    className="font-display text-xl font-bold text-ink-900"
                  >
                    Recent changes
                  </h2>
                  <p className="mt-1 text-xs text-ink-600">
                    Deletes and edits from the last 7 days. Older history is
                    permanently removed.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-2 py-1 text-sm font-bold text-ink-600 hover:bg-ink-900/5"
                >
                  Close
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {changes.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-600">
                    No changes in the last 7 days.
                  </p>
                ) : (
                  <ul className="divide-y divide-ink-900/5">
                    {changes.map((change) => {
                      const undone = Boolean(change.restored_at);
                      return (
                        <li key={change.id} className="py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-moss-500">
                                {change.action === "delete" ? "Deleted" : "Changed"}{" "}
                                · {entityLabel(change.entity_type)}
                              </p>
                              <p className="mt-1 text-sm font-semibold text-ink-900">
                                {change.summary}
                              </p>
                              <p className="mt-1 text-xs text-ink-600">
                                {new Date(change.created_at).toLocaleString()} ·{" "}
                                {undone ? "Already undone" : daysLeft(change.expires_at)}
                              </p>
                            </div>
                            {!undone ? (
                              <form
                                action={undoBudgetChangeAction}
                                onSubmit={(event) => {
                                  if (
                                    !confirm(
                                      "Undo this change? It will restore the previous data where possible.",
                                    )
                                  ) {
                                    event.preventDefault();
                                  }
                                }}
                              >
                                <input
                                  type="hidden"
                                  name="change_id"
                                  value={change.id}
                                />
                                <PendingSubmitButton
                                  pendingLabel="…"
                                  className="rounded-xl bg-moss-500 px-3 py-2 text-xs font-bold text-sand-50"
                                >
                                  Undo
                                </PendingSubmitButton>
                              </form>
                            ) : (
                              <span className="shrink-0 text-xs font-bold text-ink-500">
                                Undone
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </aside>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 hover:bg-ink-800"
      >
        <span>Recent changes & undo</span>
        <span className="text-xs font-semibold text-sand-50/80">
          {changes.filter((c) => !c.restored_at).length} available
        </span>
      </button>
      {panel}
    </>
  );
}

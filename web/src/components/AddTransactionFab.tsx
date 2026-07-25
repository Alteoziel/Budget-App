"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { createTransactionAction } from "@/lib/actions";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";

type CategoryOption = { id: string; name: string; groupName: string };

export function AddTransactionFab({
  accounts,
  categories,
  today,
}: {
  accounts: Array<{ id: string; name: string }>;
  categories: CategoryOption[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

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
          <div className="fixed inset-0 z-[80] flex items-start justify-center p-3 pt-[max(1rem,env(safe-area-inset-top))] sm:items-center sm:p-6">
            <button
              type="button"
              aria-label="Close add transaction"
              className="absolute inset-0 bg-ink-900/45 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="relative z-10 max-h-[min(90vh,44rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-sand-50 p-4 shadow-xl ring-1 ring-ink-900/10"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <h2 id={titleId} className="font-display text-xl font-bold text-ink-900">
                  Add transaction
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-2 py-1 text-sm font-bold text-ink-600 hover:bg-ink-900/5"
                >
                  Close
                </button>
              </div>

              {accounts.length === 0 ? (
                <p className="text-sm text-ink-600">
                  Create an account first, then add transactions here.
                </p>
              ) : (
                <form action={createTransactionAction} className="min-w-0 space-y-3">
                  <input type="hidden" name="return_to" value="/transactions" />
                  <label className="block min-w-0 text-sm font-semibold text-ink-700">
                    Account
                    <select
                      required
                      name="account_id"
                      defaultValue={accounts[0]?.id}
                      className="mt-1 box-border min-w-0 max-w-full w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                    >
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-0 text-sm font-semibold text-ink-700">
                    Date
                    <input
                      required
                      type="date"
                      name="occurred_on"
                      defaultValue={today}
                      className="mt-1 box-border min-w-0 max-w-full w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                    />
                  </label>
                  <label className="block min-w-0 text-sm font-semibold text-ink-700">
                    Payee
                    <input
                      name="payee"
                      placeholder="Grocery store"
                      className="mt-1 box-border min-w-0 max-w-full w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                    />
                  </label>
                  <label className="block min-w-0 text-sm font-semibold text-ink-700">
                    Category
                    <select
                      name="category_id"
                      className="mt-1 box-border min-w-0 max-w-full w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                      defaultValue=""
                    >
                      <option value="">Uncategorized</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.groupName}: {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid min-w-0 grid-cols-2 gap-3">
                    <label className="block min-w-0 text-sm font-semibold text-ink-700">
                      Amount
                      <input
                        required
                        name="amount"
                        inputMode="decimal"
                        placeholder="12.34"
                        className="mt-1 box-border min-w-0 max-w-full w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                      />
                    </label>
                    <label className="block min-w-0 text-sm font-semibold text-ink-700">
                      Direction
                      <select
                        name="direction"
                        defaultValue="outflow"
                        className="mt-1 box-border min-w-0 max-w-full w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                      >
                        <option value="outflow">Outflow</option>
                        <option value="inflow">Inflow</option>
                      </select>
                    </label>
                  </div>
                  <label className="block min-w-0 text-sm font-semibold text-ink-700">
                    Memo
                    <input
                      name="memo"
                      placeholder="Optional note"
                      className="mt-1 box-border min-w-0 max-w-full w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                    />
                  </label>
                  <PendingSubmitButton
                    pendingLabel="Saving…"
                    className="w-full rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 hover:bg-ink-800"
                  >
                    Save transaction
                  </PendingSubmitButton>
                </form>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-3 top-[max(4.5rem,calc(env(safe-area-inset-top)+3.75rem))] z-50 rounded-2xl bg-ink-900 px-3 py-2.5 text-sm font-bold text-sand-50 shadow-lg ring-1 ring-ink-900/20 hover:bg-ink-800 lg:right-8"
      >
        Add Transaction
      </button>
      {panel}
    </>
  );
}

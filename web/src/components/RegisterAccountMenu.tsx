"use client";

import { useState } from "react";
import {
  createTransactionAction,
  setAccountBalanceAction,
} from "@/lib/actions";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import { formatCents } from "@/lib/money";

type CategoryOption = { id: string; name: string; groupName: string };

/** Shared control height so native date inputs match text/select fields on mobile. */
const fieldClass =
  "mt-1 box-border min-h-12 min-w-0 max-w-full w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-3 text-base leading-normal outline-none ring-moss-400 focus:ring-2";

export function RegisterAccountMenu({
  accountId,
  balanceCents,
  categories,
  today,
  /** When set (e.g. after save redirect), keep the menu collapsed. */
  forceClosed = false,
}: {
  accountId: string;
  balanceCents: number;
  categories: CategoryOption[];
  today: string;
  forceClosed?: boolean;
}) {
  const [open, setOpen] = useState(!forceClosed);
  const [panel, setPanel] = useState<"add" | "balance">("add");

  return (
    <div className="card-surface min-w-0 overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="register-account-menu"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-2 rounded-xl px-2 py-2 text-ink-900 hover:bg-ink-900/5"
        >
          <span className="flex flex-col gap-1.5" aria-hidden>
            <span
              className={`block h-0.5 w-5 rounded-full bg-ink-900 transition ${
                open ? "translate-y-2 rotate-45" : ""
              }`}
            />
            <span
              className={`block h-0.5 w-5 rounded-full bg-ink-900 transition ${
                open ? "opacity-0" : ""
              }`}
            />
            <span
              className={`block h-0.5 w-5 rounded-full bg-ink-900 transition ${
                open ? "-translate-y-2 -rotate-45" : ""
              }`}
            />
          </span>
          <span className="text-sm font-bold">
            {open ? "Close menu" : "Add & balance"}
          </span>
        </button>
        {!open ? (
          <p className="text-xs font-semibold text-ink-600">
            Add transaction or set balance
          </p>
        ) : null}
      </div>

      {open ? (
        <div
          id="register-account-menu"
          className="min-w-0 border-t border-ink-900/5 px-4 pb-4 pt-3"
        >
          <div className="flex min-w-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPanel("add")}
              className={`rounded-xl px-3 py-2 text-sm font-bold ${
                panel === "add"
                  ? "bg-ink-900 text-sand-50"
                  : "bg-white text-ink-700 ring-1 ring-ink-900/10"
              }`}
            >
              Add transaction
            </button>
            <button
              type="button"
              onClick={() => setPanel("balance")}
              className={`rounded-xl px-3 py-2 text-sm font-bold ${
                panel === "balance"
                  ? "bg-ink-900 text-sand-50"
                  : "bg-white text-ink-700 ring-1 ring-ink-900/10"
              }`}
            >
              Set balance
            </button>
          </div>

          {panel === "add" ? (
            <form
              action={createTransactionAction}
              onSubmit={() => setOpen(false)}
              className="mt-3 min-w-0 space-y-3"
            >
              <input type="hidden" name="account_id" value={accountId} />
              <label className="block min-w-0 text-sm font-semibold text-ink-700">
                Date
                <input
                  required
                  type="date"
                  name="occurred_on"
                  defaultValue={today}
                  className={fieldClass}
                />
              </label>
              <label className="block min-w-0 text-sm font-semibold text-ink-700">
                Payee
                <input
                  name="payee"
                  placeholder="Grocery store"
                  className={fieldClass}
                />
              </label>
              <label className="block min-w-0 text-sm font-semibold text-ink-700">
                Category
                <select name="category_id" className={fieldClass} defaultValue="">
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
                    className={fieldClass}
                  />
                </label>
                <label className="block min-w-0 text-sm font-semibold text-ink-700">
                  Direction
                  <select
                    name="direction"
                    defaultValue="outflow"
                    className={fieldClass}
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
                  className={fieldClass}
                />
              </label>
              <PendingSubmitButton
                pendingLabel="Saving…"
                className="w-full rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 hover:bg-ink-800"
              >
                Save transaction
              </PendingSubmitButton>
            </form>
          ) : (
            <form
              action={setAccountBalanceAction}
              onSubmit={() => setOpen(false)}
              className="mt-3 space-y-3"
            >
              <input type="hidden" name="account_id" value={accountId} />
              <p className="text-sm text-ink-600">
                Current calculated balance is{" "}
                <span className="font-bold text-ink-900">
                  {formatCents(balanceCents)}
                </span>
                . Set what the account should show now; future transactions still
                change the total from that point.
              </p>
              <label className="block text-sm font-semibold text-ink-700">
                New balance
                <input
                  required
                  name="balance"
                  inputMode="decimal"
                  placeholder={(balanceCents / 100).toFixed(2)}
                  defaultValue={(balanceCents / 100).toFixed(2)}
                  className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-2xl bg-moss-500 px-4 py-3 text-sm font-bold text-sand-50 hover:bg-moss-600"
              >
                Save balance
              </button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}

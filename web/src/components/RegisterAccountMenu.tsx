"use client";

import { useState } from "react";
import {
  createTransactionAction,
  setAccountBalanceAction,
} from "@/lib/actions";
import { formatCents } from "@/lib/money";

type CategoryOption = { id: string; name: string; groupName: string };

export function RegisterAccountMenu({
  accountId,
  balanceCents,
  categories,
  today,
}: {
  accountId: string;
  balanceCents: number;
  categories: CategoryOption[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"add" | "balance">("add");

  return (
    <div className="rounded-3xl border border-ink-900/5 bg-sand-50/80 shadow-soft">
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
        <div id="register-account-menu" className="border-t border-ink-900/5 px-4 pb-4 pt-3">
          <div className="flex gap-2">
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
            <form action={createTransactionAction} className="mt-3 space-y-3">
              <input type="hidden" name="account_id" value={accountId} />
              <label className="block text-sm font-semibold text-ink-700">
                Date
                <input
                  required
                  type="date"
                  name="occurred_on"
                  defaultValue={today}
                  className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                />
              </label>
              <label className="block text-sm font-semibold text-ink-700">
                Payee
                <input
                  name="payee"
                  placeholder="Grocery store"
                  className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                />
              </label>
              <label className="block text-sm font-semibold text-ink-700">
                Category
                <select
                  name="category_id"
                  className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
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
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-semibold text-ink-700">
                  Amount
                  <input
                    required
                    name="amount"
                    inputMode="decimal"
                    placeholder="12.34"
                    className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                  />
                </label>
                <label className="block text-sm font-semibold text-ink-700">
                  Direction
                  <select
                    name="direction"
                    defaultValue="outflow"
                    className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                  >
                    <option value="outflow">Outflow</option>
                    <option value="inflow">Inflow</option>
                  </select>
                </label>
              </div>
              <label className="block text-sm font-semibold text-ink-700">
                Memo
                <input
                  name="memo"
                  placeholder="Optional note"
                  className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 hover:bg-ink-800"
              >
                Save transaction
              </button>
            </form>
          ) : (
            <form action={setAccountBalanceAction} className="mt-3 space-y-3">
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

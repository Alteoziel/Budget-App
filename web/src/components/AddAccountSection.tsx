"use client";

import { useState } from "react";
import { createAccountAction } from "@/lib/actions";

export function AddAccountSection() {
  const [open, setOpen] = useState(false);

  return (
    <section className="card-surface mt-6 overflow-hidden rounded-2xl">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full touch-manipulation items-center justify-between gap-3 px-4 py-3 text-left outline-none ring-moss-400 focus-visible:ring-2 focus-visible:ring-inset"
      >
        <h2 className="font-display text-lg font-bold text-ink-900">Add account</h2>
        <span
          aria-hidden
          className={`shrink-0 text-xs text-ink-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>
      {open ? (
        <form
          action={createAccountAction}
          className="space-y-3 border-t border-ink-900/8 px-4 pb-4 pt-3"
        >
          <label className="block text-sm font-semibold text-ink-700">
            Name
            <input
              required
              name="name"
              placeholder="Checking"
              className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
            />
          </label>
          <label className="block text-sm font-semibold text-ink-700">
            Type
            <select
              name="account_type"
              className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
              defaultValue="checking"
            >
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="credit">Credit</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          <button
            type="submit"
            className="w-full rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 hover:bg-ink-800"
          >
            Add account
          </button>
        </form>
      ) : null}
    </section>
  );
}

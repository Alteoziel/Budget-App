"use client";

import { useState, useTransition } from "react";
import { useOffline } from "@/components/OfflineProvider";

export function OfflineTransactionForm() {
  const { snapshot, queueTransaction, online } = useOffline();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!snapshot?.accounts.length) {
    return (
      <p className="text-sm text-ink-600">
        No cached accounts yet. Go online, open Accounts once, then try again offline.
      </p>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fd = new FormData(form);
        setMessage(null);
        setError(null);
        startTransition(async () => {
          const result = await queueTransaction({
            account_id: String(fd.get("account_id") ?? ""),
            category_id: String(fd.get("category_id") ?? ""),
            occurred_on: String(fd.get("occurred_on") ?? today),
            payee: String(fd.get("payee") ?? ""),
            memo: String(fd.get("memo") ?? ""),
            amount: String(fd.get("amount") ?? ""),
            direction: String(fd.get("direction") ?? "outflow") as
              | "inflow"
              | "outflow",
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setMessage(
            online
              ? "Saved to the offline queue and will sync next."
              : "Saved on this phone. It will sync when you’re back online.",
          );
          form.reset();
        });
      }}
    >
      <label className="block text-sm font-semibold text-ink-700">
        Account
        <select
          name="account_id"
          required
          defaultValue={snapshot.accounts[0]?.id}
          className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
        >
          {snapshot.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-semibold text-ink-700">
        Category
        <select
          name="category_id"
          defaultValue=""
          className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
        >
          <option value="">Uncategorized</option>
          {snapshot.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.groupName}: {category.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-semibold text-ink-700">
        Date
        <input
          type="date"
          name="occurred_on"
          required
          defaultValue={today}
          className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
        />
      </label>

      <label className="block text-sm font-semibold text-ink-700">
        Payee
        <input
          name="payee"
          placeholder="Coffee shop"
          className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-semibold text-ink-700">
          Amount
          <input
            required
            name="amount"
            inputMode="decimal"
            placeholder="12.34"
            className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
          />
        </label>
        <label className="block text-sm font-semibold text-ink-700">
          Direction
          <select
            name="direction"
            defaultValue="outflow"
            className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
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
          placeholder="Optional"
          className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save offline"}
      </button>
      {message ? <p className="text-xs font-semibold text-moss-500">{message}</p> : null}
      {error ? <p className="text-xs font-semibold text-coral-500">{error}</p> : null}
    </form>
  );
}

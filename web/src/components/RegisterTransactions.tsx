"use client";

import { useMemo, useState } from "react";
import { Money } from "@/components/Money";
import {
  batchDeleteTransactionsAction,
  deleteTransactionAction,
  updateTransactionAction,
} from "@/lib/actions";
import type { Transaction } from "@/lib/types";

type CategoryOption = { id: string; name: string; groupName: string };

export function RegisterTransactions({
  accountId,
  transactions,
  categories,
  accounts,
}: {
  accountId: string;
  transactions: Transaction[];
  categories: CategoryOption[];
  accounts: Array<{ id: string; name: string }>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const allSelected =
    transactions.length > 0 && transactions.every((txn) => selected.has(txn.id));

  const selectedCount = selected.size;

  const categoryLabel = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, `${c.groupName}: ${c.name}`]));
    return (categoryId: string | null) =>
      categoryId ? (map.get(categoryId) ?? "Category") : "Uncategorized";
  }, [categories]);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(transactions.map((txn) => txn.id)));
  }

  if (transactions.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-600">No transactions yet.</p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-900/5 px-4 py-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="size-4 rounded border-ink-900/20"
          />
          Select all ({transactions.length})
        </label>
        <form
          action={async (formData) => {
            setPending(true);
            try {
              await batchDeleteTransactionsAction(formData);
            } finally {
              setPending(false);
              setSelected(new Set());
              setEditingId(null);
            }
          }}
          onSubmit={(event) => {
            if (
              !confirm(
                `Delete ${selectedCount} selected transaction${selectedCount === 1 ? "" : "s"}? This cannot be undone.`,
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="account_id" value={accountId} />
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="transaction_ids" value={id} />
          ))}
          <button
            type="submit"
            disabled={selectedCount === 0 || pending}
            className="rounded-xl bg-coral-500 px-3 py-2 text-sm font-bold text-sand-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Deleting…" : `Delete selected (${selectedCount})`}
          </button>
        </form>
      </div>

      <ul className="divide-y divide-ink-900/5">
        {transactions.map((txn) => {
          const isEditing = editingId === txn.id;
          const direction = txn.amount_cents >= 0 ? "inflow" : "outflow";
          const amountAbs = (Math.abs(txn.amount_cents) / 100).toFixed(2);

          return (
            <li key={txn.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(txn.id)}
                  onChange={() => toggleOne(txn.id)}
                  className="mt-1 size-4 rounded border-ink-900/20"
                  aria-label={`Select ${txn.payee || "transaction"}`}
                />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <form
                      action={updateTransactionAction}
                      className="space-y-3"
                      onSubmit={() => setEditingId(null)}
                    >
                      <input type="hidden" name="transaction_id" value={txn.id} />
                      <input type="hidden" name="from_account_id" value={accountId} />
                      <label className="block text-xs font-semibold text-ink-600">
                        Account
                        <select
                          name="account_id"
                          defaultValue={accountId}
                          className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                        >
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs font-semibold text-ink-600">
                        Date
                        <input
                          required
                          type="date"
                          name="occurred_on"
                          defaultValue={txn.occurred_on}
                          className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                        />
                      </label>
                      <label className="block text-xs font-semibold text-ink-600">
                        Payee
                        <input
                          name="payee"
                          defaultValue={txn.payee}
                          className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                        />
                      </label>
                      <label className="block text-xs font-semibold text-ink-600">
                        Category
                        <select
                          name="category_id"
                          defaultValue={txn.category_id ?? ""}
                          className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.groupName}: {category.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs font-semibold text-ink-600">
                          Amount
                          <input
                            required
                            name="amount"
                            inputMode="decimal"
                            defaultValue={amountAbs}
                            className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                          />
                        </label>
                        <label className="block text-xs font-semibold text-ink-600">
                          Direction
                          <select
                            name="direction"
                            defaultValue={direction}
                            className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                          >
                            <option value="outflow">Outflow</option>
                            <option value="inflow">Inflow</option>
                          </select>
                        </label>
                      </div>
                      <label className="block text-xs font-semibold text-ink-600">
                        Memo
                        <input
                          name="memo"
                          defaultValue={txn.memo}
                          className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          className="rounded-xl bg-moss-500 px-3 py-2 text-sm font-bold text-sand-50"
                        >
                          Save changes
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-xl px-3 py-2 text-sm font-semibold text-ink-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink-900">
                            {txn.payee || "Untitled"}
                          </p>
                          <p className="text-xs text-ink-600">
                            {txn.occurred_on}
                            {" · "}
                            {categoryLabel(txn.category_id)}
                            {txn.memo ? ` · ${txn.memo}` : ""}
                          </p>
                        </div>
                        <p className="shrink-0 font-bold">
                          <Money cents={txn.amount_cents} />
                        </p>
                      </div>
                      <div className="mt-2 flex gap-3">
                        <button
                          type="button"
                          onClick={() => setEditingId(txn.id)}
                          className="text-xs font-bold text-moss-500"
                        >
                          Edit
                        </button>
                        <form action={deleteTransactionAction}>
                          <input type="hidden" name="transaction_id" value={txn.id} />
                          <input type="hidden" name="account_id" value={accountId} />
                          <button
                            type="submit"
                            className="text-xs font-bold text-coral-500"
                            onClick={(event) => {
                              if (!confirm("Delete this transaction?")) {
                                event.preventDefault();
                              }
                            }}
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

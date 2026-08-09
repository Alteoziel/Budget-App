"use client";

import { useMemo, useState } from "react";
import { useAnnounceEditing } from "@/components/BudgetRealtimeProvider";
import { Money } from "@/components/Money";
import {
  batchDeleteTransactionsAction,
  batchSetTransactionIgnoredAction,
  deleteTransactionAction,
  setTransactionIgnoredAction,
  updateTransactionAction,
} from "@/lib/actions";
import { isIgnoredTxn } from "@/lib/transactions-ignored";
import type { Transaction } from "@/lib/types";

type CategoryOption = { id: string; name: string; groupName: string };

export function RegisterTransactions({
  accountId,
  transactions,
  categories,
  accounts,
  showAccountName = false,
  returnTo,
  initialCategoryFilter = "all",
}: {
  accountId?: string;
  transactions: Transaction[];
  categories: CategoryOption[];
  accounts: Array<{ id: string; name: string }>;
  showAccountName?: boolean;
  returnTo?: string;
  /** Prefill category filter (e.g. "uncategorized" from nav badge). */
  initialCategoryFilter?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(
    () => initialCategoryFilter !== "all",
  );
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(initialCategoryFilter);
  const [accountFilter, setAccountFilter] = useState("all");
  const [flowFilter, setFlowFilter] = useState<"all" | "income" | "spending">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const editingTxn = editingId
    ? transactions.find((txn) => txn.id === editingId)
    : null;
  useAnnounceEditing(
    editingTxn
      ? {
          kind: "transaction",
          id: editingTxn.id,
          label: `txn · ${editingTxn.payee || "Untitled"}`,
        }
      : null,
  );

  const accountName = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.id, a.name]));
    return (id: string) => map.get(id) ?? "Account";
  }, [accounts]);

  const categoryLabel = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, `${c.groupName}: ${c.name}`]));
    return (categoryId: string | null) =>
      categoryId ? (map.get(categoryId) ?? "Category") : "Uncategorized";
  }, [categories]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return transactions.filter((txn) => {
      if (needle) {
        const haystack =
          `${txn.payee} ${txn.memo} ${categoryLabel(txn.category_id)} ${accountName(txn.account_id)}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (categoryFilter === "uncategorized") {
        if (txn.category_id) return false;
      } else if (categoryFilter !== "all" && txn.category_id !== categoryFilter) {
        return false;
      }
      if (accountFilter !== "all" && txn.account_id !== accountFilter) {
        return false;
      }
      if (flowFilter === "income" && txn.amount_cents <= 0) return false;
      if (flowFilter === "spending" && txn.amount_cents >= 0) return false;
      if (fromDate && txn.occurred_on < fromDate) return false;
      if (toDate && txn.occurred_on > toDate) return false;
      return true;
    });
  }, [
    transactions,
    search,
    categoryFilter,
    accountFilter,
    flowFilter,
    fromDate,
    toDate,
    categoryLabel,
    accountName,
  ]);

  const filtersActive =
    Boolean(search.trim()) ||
    categoryFilter !== "all" ||
    accountFilter !== "all" ||
    flowFilter !== "all" ||
    Boolean(fromDate) ||
    Boolean(toDate);

  const filteredTotalCents = filtered.reduce((sum, txn) => sum + txn.amount_cents, 0);

  const allSelected =
    filtered.length > 0 && filtered.every((txn) => selected.has(txn.id));

  const selectedCount = selected.size;

  function clearFilters() {
    setSearch("");
    setCategoryFilter("all");
    setAccountFilter("all");
    setFlowFilter("all");
    setFromDate("");
    setToDate("");
  }

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
    setSelected(new Set(filtered.map((txn) => txn.id)));
  }

  if (transactions.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-600">No transactions yet.</p>
    );
  }

  return (
    <div>
      <div className="border-b border-ink-900/5 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            className="min-h-11 rounded-xl bg-sand-100 px-3 py-2 text-sm font-bold text-ink-800"
          >
            {filtersOpen ? "Hide filters" : "Filters"}
            {filtersActive ? " · on" : ""}
          </button>
          <p className="text-xs font-semibold text-ink-600">
            {filtersActive
              ? `${filtered.length} of ${transactions.length} · net `
              : `${transactions.length} transactions · net `}
            <Money cents={filteredTotalCents} />
          </p>
        </div>

        {filtersOpen ? (
          <div className="mt-3 space-y-3">
            <label className="block text-xs font-semibold text-ink-600">
              Search payee, memo, category{showAccountName ? ", or account" : ""}
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Coffee"
                className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              {showAccountName ? (
                <label className="block text-xs font-semibold text-ink-600">
                  Account
                  <select
                    value={accountFilter}
                    onChange={(event) => setAccountFilter(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                  >
                    <option value="all">All accounts</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="block text-xs font-semibold text-ink-600">
                Category
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                >
                  <option value="all">All categories</option>
                  <option value="uncategorized">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.groupName}: {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-semibold text-ink-600">
                Type
                <select
                  value={flowFilter}
                  onChange={(event) =>
                    setFlowFilter(event.target.value as "all" | "income" | "spending")
                  }
                  className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                >
                  <option value="all">Income & spending</option>
                  <option value="income">Income only</option>
                  <option value="spending">Spending only</option>
                </select>
              </label>

              <label className="block text-xs font-semibold text-ink-600">
                From
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                />
              </label>

              <label className="block text-xs font-semibold text-ink-600">
                To
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                />
              </label>
            </div>

            {filtersActive ? (
              <button
                type="button"
                onClick={clearFilters}
                className="min-h-11 text-xs font-bold text-coral-500"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-900/5 px-4 py-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="size-4 rounded border-ink-900/20"
          />
          Select all ({filtered.length})
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <form
            action={async (formData) => {
              setPending(true);
              try {
                await batchSetTransactionIgnoredAction(formData);
              } finally {
                setPending(false);
                setSelected(new Set());
                setEditingId(null);
              }
            }}
          >
            {accountId ? (
              <input type="hidden" name="account_id" value={accountId} />
            ) : null}
            {returnTo ? (
              <input type="hidden" name="return_to" value={returnTo} />
            ) : null}
            <input type="hidden" name="ignored" value="1" />
            {[...selected].map((id) => (
              <input key={id} type="hidden" name="transaction_ids" value={id} />
            ))}
            <button
              type="submit"
              disabled={selectedCount === 0 || pending}
              className="rounded-xl border border-ink-900/15 bg-sand-50 px-3 py-2 text-sm font-bold text-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending
                ? "Updating…"
                : `Ignore in insights (${selectedCount})`}
            </button>
          </form>
          <form
            action={async (formData) => {
              setPending(true);
              try {
                await batchSetTransactionIgnoredAction(formData);
              } finally {
                setPending(false);
                setSelected(new Set());
                setEditingId(null);
              }
            }}
          >
            {accountId ? (
              <input type="hidden" name="account_id" value={accountId} />
            ) : null}
            {returnTo ? (
              <input type="hidden" name="return_to" value={returnTo} />
            ) : null}
            <input type="hidden" name="ignored" value="0" />
            {[...selected].map((id) => (
              <input key={id} type="hidden" name="transaction_ids" value={id} />
            ))}
            <button
              type="submit"
              disabled={selectedCount === 0 || pending}
              className="rounded-xl border border-moss-500/30 bg-moss-500/10 px-3 py-2 text-sm font-bold text-moss-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-moss-200"
            >
              {pending
                ? "Updating…"
                : `Include in insights (${selectedCount})`}
            </button>
          </form>
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
                  `Delete ${selectedCount} selected transaction${selectedCount === 1 ? "" : "s"}? You can undo this from Settings → People & access for 7 days.`,
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            {accountId ? (
              <input type="hidden" name="account_id" value={accountId} />
            ) : null}
            {returnTo ? (
              <input type="hidden" name="return_to" value={returnTo} />
            ) : null}
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
      </div>

      {filtered.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink-600">
          No transactions match these filters.
        </p>
      ) : null}

      <ul className="divide-y divide-ink-900/5">
        {filtered.map((txn) => {
          const isEditing = editingId === txn.id;
          const direction = txn.amount_cents >= 0 ? "inflow" : "outflow";
          const amountAbs = (Math.abs(txn.amount_cents) / 100).toFixed(2);
          const rowAccountId = txn.account_id;
          const ignored = isIgnoredTxn(txn);

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
                      <input type="hidden" name="from_account_id" value={rowAccountId} />
                      {returnTo ? (
                        <input type="hidden" name="return_to" value={returnTo} />
                      ) : null}
                      <label className="block text-xs font-semibold text-ink-600">
                        Account
                        <select
                          name="account_id"
                          defaultValue={rowAccountId}
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
                            {!txn.cleared ? (
                              <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide text-ink-500">
                                Pending
                              </span>
                            ) : null}
                            {ignored ? (
                              <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide text-ink-500">
                                Ignored in insights
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-ink-600">
                            {txn.occurred_on}
                            {showAccountName
                              ? ` · ${accountName(txn.account_id)}`
                              : ""}
                            {" · "}
                            {categoryLabel(txn.category_id)}
                            {txn.memo ? ` · ${txn.memo}` : ""}
                          </p>
                        </div>
                        <p className="shrink-0 font-bold">
                          <Money cents={txn.amount_cents} />
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => setEditingId(txn.id)}
                          className="text-xs font-bold text-moss-500"
                        >
                          Edit
                        </button>
                        <form action={setTransactionIgnoredAction}>
                          <input type="hidden" name="transaction_id" value={txn.id} />
                          <input type="hidden" name="account_id" value={rowAccountId} />
                          <input
                            type="hidden"
                            name="ignored"
                            value={ignored ? "0" : "1"}
                          />
                          {returnTo ? (
                            <input type="hidden" name="return_to" value={returnTo} />
                          ) : null}
                          <button
                            type="submit"
                            className="text-xs font-bold text-ink-600"
                          >
                            {ignored ? "Unignore" : "Ignore"}
                          </button>
                        </form>
                        <form action={deleteTransactionAction}>
                          <input type="hidden" name="transaction_id" value={txn.id} />
                          <input type="hidden" name="account_id" value={rowAccountId} />
                          {returnTo ? (
                            <input type="hidden" name="return_to" value={returnTo} />
                          ) : null}
                          <button
                            type="submit"
                            className="text-xs font-bold text-coral-500"
                            onClick={(event) => {
                              if (
                                !confirm(
                                  "Delete this transaction? You can undo this from Settings → People & access for 7 days.",
                                )
                              ) {
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

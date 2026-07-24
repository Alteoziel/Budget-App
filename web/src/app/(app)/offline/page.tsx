"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { Money } from "@/components/Money";
import { OfflineTransactionForm } from "@/components/OfflineTransactionForm";
import { useOffline } from "@/components/OfflineProvider";
import { formatBudgetMonth } from "@/lib/money";

export default function OfflinePage() {
  const { online, snapshot, outboxCount, refreshSnapshot, flushOutbox } = useOffline();

  const groups = useMemo(() => {
    if (!snapshot) return [];
    const map = new Map<string, typeof snapshot.categories>();
    for (const category of snapshot.categories) {
      const list = map.get(category.groupName) ?? [];
      list.push(category);
      map.set(category.groupName, list);
    }
    return [...map.entries()];
  }, [snapshot]);

  return (
    <AppShell
      title="Offline"
      subtitle={
        snapshot
          ? `${snapshot.budget.name} · ${formatBudgetMonth(snapshot.month)}`
          : "Cached on this device"
      }
    >
      <div className="space-y-5">
        <section
          className={`rounded-3xl px-5 py-5 shadow-soft ${
            online ? "bg-moss-500 text-sand-50" : "bg-coral-500 text-sand-50"
          }`}
        >
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-sand-100">
            {online ? "Back online" : "Airplane / offline mode"}
          </p>
          <p className="mt-2 font-display text-2xl font-bold">
            {snapshot
              ? `Snapshot from ${new Date(snapshot.savedAt).toLocaleString()}`
              : "No snapshot saved yet"}
          </p>
          <p className="mt-2 text-sm text-sand-100">
            {snapshot
              ? "Browse balances and recent transactions from your last sync. New offline transactions queue on this phone until you reconnect."
              : "While online, open Budget or Accounts once so we can save a local copy for offline use."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {online ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void refreshSnapshot();
                  }}
                  className="min-h-11 rounded-2xl bg-sand-50 px-4 py-2 text-sm font-bold text-ink-900"
                >
                  Refresh snapshot
                </button>
                {outboxCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      void flushOutbox();
                    }}
                    className="min-h-11 rounded-2xl border border-sand-50/50 px-4 py-2 text-sm font-bold text-sand-50"
                  >
                    Sync {outboxCount} queued
                  </button>
                ) : null}
              </>
            ) : (
              <Link
                href="/budget"
                className="min-h-11 rounded-2xl bg-sand-50 px-4 py-2 text-sm font-bold text-ink-900"
              >
                Retry live Budget
              </Link>
            )}
          </div>
        </section>

        {snapshot ? (
          <>
            <section className="rounded-3xl bg-ink-900 px-5 py-5 text-sand-50 shadow-soft">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-moss-300">
                Ready to assign
              </p>
              <p className="mt-2 font-display text-4xl font-bold">
                <Money cents={snapshot.readyToAssignCents} className="text-sand-50" />
              </p>
            </section>

            <section className="overflow-hidden rounded-3xl bg-sand-50/80 shadow-soft">
              <div className="border-b border-ink-900/5 px-4 py-3">
                <h2 className="font-display text-lg font-bold text-ink-900">Accounts</h2>
              </div>
              <ul className="divide-y divide-ink-900/5">
                {snapshot.accounts.map((account) => (
                  <li
                    key={account.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <p className="font-semibold text-ink-900">{account.name}</p>
                      <p className="text-xs uppercase tracking-wide text-ink-600">
                        {account.account_type}
                      </p>
                    </div>
                    <p className="font-bold">
                      <Money cents={account.balanceCents} />
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-lg font-bold text-ink-900">Categories</h2>
              {groups.map(([groupName, categories]) => (
                <div
                  key={groupName}
                  className="overflow-hidden rounded-3xl bg-sand-50/80 shadow-soft"
                >
                  <div className="border-b border-ink-900/5 px-4 py-3">
                    <h3 className="font-display text-base font-bold text-ink-900">
                      {groupName}
                    </h3>
                  </div>
                  <ul className="divide-y divide-ink-900/5">
                    {categories.map((category) => (
                      <li
                        key={category.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <p className="font-semibold text-ink-900">{category.name}</p>
                          <p className="text-xs text-ink-600">
                            Assigned <Money cents={category.assignedCents} /> · Activity{" "}
                            <Money cents={category.activityCents} />
                          </p>
                        </div>
                        <p className="font-bold">
                          <Money cents={category.availableCents} />
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            <section className="overflow-hidden rounded-3xl bg-sand-50/80 shadow-soft">
              <div className="border-b border-ink-900/5 px-4 py-3">
                <h2 className="font-display text-lg font-bold text-ink-900">
                  Recent transactions
                </h2>
              </div>
              {snapshot.recentTransactions.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-ink-600">
                  No recent transactions in the snapshot.
                </p>
              ) : (
                <ul className="divide-y divide-ink-900/5">
                  {snapshot.recentTransactions.slice(0, 40).map((txn) => (
                    <li key={txn.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink-900">
                            {txn.payee || "Untitled"}
                          </p>
                          <p className="text-xs text-ink-600">
                            {txn.occurred_on} · {txn.accountName}
                            {txn.categoryName ? ` · ${txn.categoryName}` : ""}
                          </p>
                        </div>
                        <p className="shrink-0 font-bold">
                          <Money cents={txn.amount_cents} />
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-3xl border border-ink-900/5 bg-sand-50/80 p-4 shadow-soft">
              <h2 className="font-display text-lg font-bold text-ink-900">
                Add transaction offline
              </h2>
              <p className="mt-1 text-sm text-ink-600">
                Saves on this iPhone first, then syncs to your budget when you’re online
                again.
              </p>
              <div className="mt-3">
                <OfflineTransactionForm />
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

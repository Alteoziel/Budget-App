import { Money } from "@/components/Money";
import type { BudgetSnapshot } from "@/lib/types";

export function BudgetSnapshotPanel({ snapshot }: { snapshot: BudgetSnapshot }) {
  const groupMap = new Map<
    string,
    { groupName: string; categories: typeof snapshot.rows }
  >();
  for (const row of snapshot.rows) {
    const existing = groupMap.get(row.groupId);
    if (existing) {
      existing.categories.push(row);
    } else {
      groupMap.set(row.groupId, {
        groupName: row.groupName,
        categories: [row],
      });
    }
  }
  const groups = [...groupMap.values()];

  return (
    <div className="space-y-4">
      <section className="hero-panel animate-rise rounded-2xl px-4 py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-80">
          {snapshot.kind === "day" ? "Day snapshot" : "Month snapshot"} ·{" "}
          {snapshot.label}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total money" cents={snapshot.totalMoneyCents} />
          <Stat label="Ready to assign" cents={snapshot.readyToAssignCents} />
          <Stat label="Income" cents={snapshot.incomeCents} />
          <Stat label="Spending" cents={-snapshot.spendingCents} />
        </div>
        {snapshot.kind === "day" ? (
          <p className="mt-3 text-xs font-medium opacity-80">
            Assigned amounts are for the whole month; activity and total money
            are through this day.
          </p>
        ) : (
          <p className="mt-3 text-xs font-medium opacity-80">
            Read-only view of budget, activity, and cash for this month.
          </p>
        )}
      </section>

      <section className="card-surface animate-rise-delay rounded-2xl p-4">
        <h2 className="font-display text-base font-bold text-ink-900">Budget</h2>
        {groups.length === 0 ? (
          <p className="mt-2 text-sm text-ink-600">No categories yet.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {groups.map((group) => (
              <div key={group.groupName}>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">
                  {group.groupName}
                </h3>
                <ul className="mt-1.5 divide-y divide-ink-900/8">
                  {group.categories.map((row) => (
                    <li
                      key={row.categoryId}
                      className="flex items-start justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-900">
                          {row.categoryName}
                        </p>
                        <p className="text-xs text-ink-500">
                          Assigned <Money cents={row.assignedCents} /> · Activity{" "}
                          <Money cents={row.activityCents} />
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-bold tabular-nums">
                        <Money cents={row.availableCents} />
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card-surface rounded-2xl p-4">
        <h2 className="font-display text-base font-bold text-ink-900">
          Transactions
        </h2>
        <p className="mt-1 text-xs text-ink-500">
          {snapshot.kind === "day"
            ? "On this day"
            : "In this month"}{" "}
          · up to 80 most recent
        </p>
        {snapshot.transactions.length === 0 ? (
          <p className="mt-3 text-sm text-ink-600">No transactions in this period.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-900/8">
            {snapshot.transactions.map((txn) => (
              <li
                key={txn.id}
                className="flex items-start justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {txn.payee}
                  </p>
                  <p className="truncate text-xs text-ink-500">
                    {txn.occurredOn}
                    {txn.categoryName ? ` · ${txn.categoryName}` : " · Uncategorized"}
                    {` · ${txn.accountName}`}
                  </p>
                  {txn.memo ? (
                    <p className="truncate text-xs text-ink-400">{txn.memo}</p>
                  ) : null}
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums">
                  <Money cents={txn.amountCents} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-75">
        {label}
      </p>
      <p className="font-display text-lg font-bold leading-tight">
        <Money cents={cents} className="text-inherit" />
      </p>
    </div>
  );
}

import Link from "next/link";
import { AddTransactionFab } from "@/components/AddTransactionFab";
import { AppShell } from "@/components/AppShell";
import { FlashError } from "@/components/FlashError";
import { RegisterTransactions } from "@/components/RegisterTransactions";
import { getAllTransactionsRegister } from "@/lib/budget-data";

function resolveLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.min(Math.max(Math.trunc(n), 25), 500);
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    notice?: string;
    limit?: string;
    category?: string;
  }>;
}) {
  const query = await searchParams;
  const limit = resolveLimit(query.limit);
  const { transactions, categories, accounts, hasMore } =
    await getAllTransactionsRegister(limit);
  const today = new Date().toISOString().slice(0, 10);
  const nextLimit = Math.min(limit + 100, 500);
  const initialCategoryFilter =
    query.category === "uncategorized" ||
    (query.category && categories.some((c) => c.id === query.category))
      ? query.category
      : "all";
  const loadMoreHref =
    initialCategoryFilter !== "all"
      ? `/transactions?limit=${nextLimit}&category=${encodeURIComponent(initialCategoryFilter)}`
      : `/transactions?limit=${nextLimit}`;

  return (
    <AppShell
      title="Transactions"
      subtitle="All accounts, newest first"
    >
      <FlashError message={query.error} />
      <FlashError message={query.notice} tone="success" />

      <AddTransactionFab
        key={query.notice || query.error || "fab"}
        accounts={accounts}
        categories={categories}
        today={today}
      />

      <section className="animate-rise card-surface mt-2 overflow-hidden rounded-2xl">
        <RegisterTransactions
          key={`register:${initialCategoryFilter}`}
          transactions={transactions}
          categories={categories}
          accounts={accounts}
          showAccountName
          returnTo="/transactions"
          initialCategoryFilter={initialCategoryFilter}
        />
        {hasMore ? (
          <div className="border-t border-ink-900/8 px-4 py-3">
            <Link
              href={loadMoreHref}
              prefetch={false}
              className="flex min-h-11 touch-manipulation items-center justify-center rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-sand-50"
            >
              Load more
            </Link>
            <p className="mt-2 text-center text-xs text-ink-500">
              Showing latest {transactions.length}
            </p>
          </div>
        ) : transactions.length > 0 ? (
          <p className="border-t border-ink-900/8 px-4 py-3 text-center text-xs text-ink-500">
            Showing latest {transactions.length}
          </p>
        ) : null}
      </section>
    </AppShell>
  );
}

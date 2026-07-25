import { AddTransactionFab } from "@/components/AddTransactionFab";
import { AppShell } from "@/components/AppShell";
import { FlashError } from "@/components/FlashError";
import { RegisterTransactions } from "@/components/RegisterTransactions";
import { getAllTransactionsRegister } from "@/lib/budget-data";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const query = await searchParams;
  const { transactions, categories, accounts } = await getAllTransactionsRegister();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell
      title="Transactions"
      subtitle="All accounts, newest first"
    >
      <FlashError message={query.error} />
      <FlashError message={query.notice} tone="success" />

      <AddTransactionFab
        accounts={accounts}
        categories={categories}
        today={today}
      />

      <section className="animate-rise card-surface mt-2 overflow-hidden rounded-2xl pb-16">
        <RegisterTransactions
          transactions={transactions}
          categories={categories}
          accounts={accounts}
          showAccountName
          returnTo="/transactions"
        />
      </section>
    </AppShell>
  );
}

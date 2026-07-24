import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { FlashError } from "@/components/FlashError";
import { Money } from "@/components/Money";
import { RegisterAccountMenu } from "@/components/RegisterAccountMenu";
import { RegisterTransactions } from "@/components/RegisterTransactions";
import { TransactionMatchSuggestions } from "@/components/TransactionMatchSuggestions";
import { getAccountRegister } from "@/lib/budget-data";

export default async function AccountRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { account, transactions, balanceCents, categories, matchSuggestions } =
    await getAccountRegister(id);
  if (!account) notFound();

  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell title={account.name} subtitle="Account register">
      <div className="mb-4">
        <Link href="/accounts" className="text-sm font-semibold text-moss-500">
          ← All accounts
        </Link>
      </div>
      <FlashError message={query.error} />

      <div className="space-y-5">
        <RegisterAccountMenu
          accountId={account.id}
          balanceCents={balanceCents}
          categories={categories}
          today={today}
        />

        <section className="animate-rise rounded-3xl bg-ink-900 px-5 py-5 text-sand-50 shadow-soft">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-moss-300">
            Balance
          </p>
          <p className="mt-2 font-display text-4xl font-bold">
            <Money cents={balanceCents} className="text-sand-50" />
          </p>
        </section>

        <TransactionMatchSuggestions
          accountId={account.id}
          suggestions={matchSuggestions}
        />

        <section className="animate-rise-delay overflow-hidden rounded-3xl bg-sand-50/80 shadow-soft">
          <RegisterTransactions
            accountId={account.id}
            transactions={transactions}
            categories={categories}
          />
        </section>

        <section className="rounded-3xl border border-coral-400/30 bg-coral-400/10 p-4">
          <h2 className="font-display text-lg font-bold text-ink-900">Delete account</h2>
          <p className="mt-1 text-sm text-ink-600">
            Removes “{account.name}” and all of its transactions from this budget.
          </p>
          <div className="mt-3">
            <DeleteAccountButton
              accountId={account.id}
              accountName={account.name}
              transactionCount={transactions.length}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

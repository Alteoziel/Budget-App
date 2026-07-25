import { AppShell } from "@/components/AppShell";
import { AccountsList } from "@/components/AccountsList";
import { AddAccountSection } from "@/components/AddAccountSection";
import { FlashError } from "@/components/FlashError";
import { Money } from "@/components/Money";
import { getAccountsWithBalances } from "@/lib/budget-data";

export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const accounts = await getAccountsWithBalances();
  const included = accounts.filter((account) => account.include_in_total);
  const total = included.reduce((sum, account) => sum + account.balanceCents, 0);
  const excludedCount = accounts.length - included.length;

  return (
    <AppShell title="Accounts" subtitle="Balances from your transactions">
      <FlashError message={params.error} />
      <FlashError message={params.notice} tone="success" />
      <section className="hero-panel animate-rise rounded-2xl px-4 py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-80">
          All accounts
        </p>
        <p className="mt-1 font-display text-3xl font-bold">
          <Money cents={total} className="text-inherit" />
        </p>
        <p className="mt-1 text-sm opacity-80">
          {accounts.length === 0
            ? "No accounts yet"
            : excludedCount === 0
              ? `Including all ${accounts.length} account${accounts.length === 1 ? "" : "s"}`
              : `Including ${included.length} of ${accounts.length} accounts`}
        </p>
      </section>

      <section className="animate-rise-delay mt-5 card-surface overflow-hidden rounded-2xl">
        {accounts.length > 0 ? (
          <p className="border-b border-ink-900/5 px-4 py-3 text-xs font-semibold text-ink-600">
            Check accounts to include them in the All accounts total. Your
            choices are saved for this budget.
          </p>
        ) : null}
        <AccountsList accounts={accounts} />
      </section>

      <AddAccountSection />
    </AppShell>
  );
}

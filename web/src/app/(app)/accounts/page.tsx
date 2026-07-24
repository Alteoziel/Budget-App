import { AppShell } from "@/components/AppShell";
import { AccountsList } from "@/components/AccountsList";
import { FlashError } from "@/components/FlashError";
import { Money } from "@/components/Money";
import { createAccountAction } from "@/lib/actions";
import { getAccountsWithBalances } from "@/lib/budget-data";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const accounts = await getAccountsWithBalances();
  const included = accounts.filter((account) => account.include_in_total);
  const total = included.reduce((sum, account) => sum + account.balanceCents, 0);
  const excludedCount = accounts.length - included.length;

  return (
    <AppShell title="Accounts" subtitle="Balances from your transactions">
      <FlashError message={params.error} />
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
            Check accounts to include them in the All accounts total. Your choices
            are saved for this budget.
          </p>
        ) : null}
        <AccountsList accounts={accounts} />
      </section>

      <section className="mt-6 card-surface rounded-2xl p-4">
        <h2 className="font-display text-lg font-bold text-ink-900">Add account</h2>
        <form action={createAccountAction} className="mt-3 space-y-3">
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
      </section>
    </AppShell>
  );
}

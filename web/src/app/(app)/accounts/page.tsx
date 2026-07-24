import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
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
  const total = accounts.reduce((sum, account) => sum + account.balanceCents, 0);

  return (
    <AppShell title="Accounts" subtitle="Balances from your transactions">
      <FlashError message={params.error} />
      <section className="animate-rise rounded-3xl bg-ink-900 px-5 py-5 text-sand-50 shadow-soft">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-moss-300">
          All accounts
        </p>
        <p className="mt-2 font-display text-4xl font-bold">
          <Money cents={total} className="text-sand-50" />
        </p>
      </section>

      <section className="animate-rise-delay mt-5 overflow-hidden rounded-3xl bg-sand-50/80 shadow-soft">
        {accounts.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-600">
            No accounts yet. Add one below or import a YNAB CSV.
          </p>
        ) : (
          <ul className="divide-y divide-ink-900/5">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="flex items-center gap-2 px-4 py-4 transition hover:bg-sand-100"
              >
                <Link
                  href={`/accounts/${account.id}`}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-900">{account.name}</p>
                    <p className="text-xs uppercase tracking-wide text-ink-600">
                      {account.account_type}
                    </p>
                  </div>
                  <p className="shrink-0 font-bold">
                    <Money cents={account.balanceCents} />
                  </p>
                </Link>
                <DeleteAccountButton
                  accountId={account.id}
                  accountName={account.name}
                  variant="link"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-3xl border border-ink-900/5 bg-sand-50/80 p-4 shadow-soft">
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Money } from "@/components/Money";
import { createTransactionAction } from "@/lib/actions";
import { getAccountRegister } from "@/lib/budget-data";

export default async function AccountRegisterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { account, transactions, categories } = await getAccountRegister(id);
  if (!account) notFound();

  const balance = transactions.reduce((sum, txn) => sum + txn.amount_cents, 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell title={account.name} subtitle="Account register">
      <div className="mb-4">
        <Link href="/accounts" className="text-sm font-semibold text-moss-500">
          ← All accounts
        </Link>
      </div>

      <section className="animate-rise rounded-3xl bg-ink-900 px-5 py-5 text-sand-50 shadow-soft">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-moss-300">Balance</p>
        <p className="mt-2 font-display text-4xl font-bold">
          <Money cents={balance} className="text-sand-50" />
        </p>
      </section>

      <section className="animate-rise-delay mt-5 overflow-hidden rounded-3xl bg-sand-50/80 shadow-soft">
        {transactions.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-600">
            No transactions yet.
          </p>
        ) : (
          <ul className="divide-y divide-ink-900/5">
            {transactions.map((txn) => (
              <li key={txn.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-semibold text-ink-900">{txn.payee || "Untitled"}</p>
                  <p className="text-xs text-ink-600">
                    {txn.occurred_on}
                    {txn.memo ? ` · ${txn.memo}` : ""}
                  </p>
                </div>
                <p className="font-bold">
                  <Money cents={txn.amount_cents} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-3xl border border-ink-900/5 bg-sand-50/80 p-4 shadow-soft">
        <h2 className="font-display text-lg font-bold text-ink-900">Add transaction</h2>
        <form action={createTransactionAction} className="mt-3 space-y-3">
          <input type="hidden" name="account_id" value={account.id} />
          <label className="block text-sm font-semibold text-ink-700">
            Date
            <input
              required
              type="date"
              name="occurred_on"
              defaultValue={today}
              className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
            />
          </label>
          <label className="block text-sm font-semibold text-ink-700">
            Payee
            <input
              name="payee"
              placeholder="Grocery store"
              className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
            />
          </label>
          <label className="block text-sm font-semibold text-ink-700">
            Category
            <select
              name="category_id"
              className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
              defaultValue=""
            >
              <option value="">Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.groupName}: {category.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold text-ink-700">
              Amount
              <input
                required
                name="amount"
                inputMode="decimal"
                placeholder="12.34"
                className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
              />
            </label>
            <label className="block text-sm font-semibold text-ink-700">
              Direction
              <select
                name="direction"
                defaultValue="outflow"
                className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
              >
                <option value="outflow">Outflow</option>
                <option value="inflow">Inflow</option>
              </select>
            </label>
          </div>
          <label className="block text-sm font-semibold text-ink-700">
            Memo
            <input
              name="memo"
              placeholder="Optional note"
              className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 hover:bg-ink-800"
          >
            Save transaction
          </button>
        </form>
      </section>
    </AppShell>
  );
}

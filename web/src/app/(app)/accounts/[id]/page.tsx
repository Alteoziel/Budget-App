import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { FlashError } from "@/components/FlashError";
import { Money } from "@/components/Money";
import { RegisterTransactions } from "@/components/RegisterTransactions";
import { createTransactionAction } from "@/lib/actions";
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
  const { account, transactions, balanceCents, categories } =
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

      <section className="animate-rise rounded-3xl bg-ink-900 px-5 py-5 text-sand-50 shadow-soft">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-moss-300">Balance</p>
        <p className="mt-2 font-display text-4xl font-bold">
          <Money cents={balanceCents} className="text-sand-50" />
        </p>
      </section>

      <section className="animate-rise-delay mt-5 overflow-hidden rounded-3xl bg-sand-50/80 shadow-soft">
        <RegisterTransactions
          accountId={account.id}
          transactions={transactions}
          categories={categories}
        />
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

      <section className="mt-6 rounded-3xl border border-coral-400/30 bg-coral-400/10 p-4">
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
    </AppShell>
  );
}

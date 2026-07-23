import { AppShell } from "@/components/AppShell";
import { ImportForm } from "@/components/ImportForm";

export default function ImportPage() {
  return (
    <AppShell
      title="Import"
      subtitle="Bring your YNAB register into Alte' Budgeting"
    >
      <section className="animate-rise">
        <ImportForm />
      </section>

      <section className="animate-rise-delay mt-6 rounded-3xl border border-ink-900/5 bg-sand-50/80 p-4 text-sm text-ink-700 shadow-soft">
        <h2 className="font-display text-lg font-bold text-ink-900">Expected columns</h2>
        <p className="mt-2">
          <code className="rounded bg-sand-100 px-1.5 py-0.5 text-xs">
            Account, Date, Payee, Category Group/Category, Memo, Outflow, Inflow
          </code>
        </p>
        <p className="mt-3">
          Accounts and categories are created automatically from the CSV. Assigned
          budget amounts stay at zero so you can set them in Budget.
        </p>
      </section>
    </AppShell>
  );
}

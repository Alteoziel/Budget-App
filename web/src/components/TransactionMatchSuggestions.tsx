import { Money } from "@/components/Money";
import {
  approveTransactionMatchAction,
  denyTransactionMatchAction,
} from "@/lib/actions";

export type MatchSuggestionView = {
  id: string;
  amountDiffCents: number;
  manual: {
    id: string;
    payee: string;
    occurred_on: string;
    amount_cents: number;
  };
  bank: {
    id: string;
    payee: string;
    occurred_on: string;
    amount_cents: number;
  };
};

export function TransactionMatchSuggestions({
  accountId,
  suggestions,
}: {
  accountId: string;
  suggestions: MatchSuggestionView[];
}) {
  if (suggestions.length === 0) return null;

  return (
    <section className="animate-rise rounded-3xl border border-moss-400/40 bg-moss-400/10 p-4 shadow-soft">
      <h2 className="font-display text-lg font-bold text-ink-900">
        Review bank matches
      </h2>
      <p className="mt-1 text-sm text-ink-600">
        Bank sync found transactions that look like ones you entered manually.
        Approve to keep your category and link the bank id, or deny to leave both.
      </p>
      <ul className="mt-3 space-y-3">
        {suggestions.map((suggestion) => (
          <li
            key={suggestion.id}
            className="rounded-2xl bg-sand-50/90 px-4 py-3 ring-1 ring-ink-900/5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-500">
                    Manual
                  </p>
                  <p className="font-semibold text-ink-900">
                    {suggestion.manual.payee || "Untitled"}
                  </p>
                  <p className="text-xs text-ink-600">
                    {suggestion.manual.occurred_on} ·{" "}
                    <Money cents={suggestion.manual.amount_cents} />
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-500">
                    Bank
                  </p>
                  <p className="font-semibold text-ink-900">
                    {suggestion.bank.payee || "Bank transaction"}
                  </p>
                  <p className="text-xs text-ink-600">
                    {suggestion.bank.occurred_on} ·{" "}
                    <Money cents={suggestion.bank.amount_cents} />
                    {suggestion.amountDiffCents > 0
                      ? ` · ${suggestion.amountDiffCents}¢ apart`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <form action={approveTransactionMatchAction}>
                  <input type="hidden" name="suggestion_id" value={suggestion.id} />
                  <input type="hidden" name="account_id" value={accountId} />
                  <button
                    type="submit"
                    title="Approve link"
                    aria-label="Approve match"
                    className="flex size-10 items-center justify-center rounded-xl bg-moss-500 text-lg font-bold text-sand-50 hover:bg-moss-600"
                  >
                    ✓
                  </button>
                </form>
                <form action={denyTransactionMatchAction}>
                  <input type="hidden" name="suggestion_id" value={suggestion.id} />
                  <input type="hidden" name="account_id" value={accountId} />
                  <button
                    type="submit"
                    title="Deny link"
                    aria-label="Deny match"
                    className="flex size-10 items-center justify-center rounded-xl bg-coral-500 text-lg font-bold text-sand-50 hover:bg-coral-600"
                  >
                    ✕
                  </button>
                </form>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { Money } from "@/components/Money";
import {
  reorderAccountsAction,
  setAccountIncludeInTotalAction,
} from "@/lib/actions";

type AccountRow = {
  id: string;
  name: string;
  account_type: string;
  balanceCents: number;
  include_in_total: boolean;
  sort_order?: number;
};

const moveBtnClass =
  "min-h-9 min-w-9 rounded-lg border border-ink-900/15 bg-sand-50 px-1.5 text-xs font-bold text-ink-700 disabled:cursor-not-allowed disabled:opacity-30";

export function AccountsList({
  accounts,
  canReorder = true,
}: {
  accounts: AccountRow[];
  canReorder?: boolean;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<AccountRow[] | null>(null);
  const [accountsSnapshot, setAccountsSnapshot] = useState(accounts);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (accounts !== accountsSnapshot) {
    setAccountsSnapshot(accounts);
    setOptimistic(null);
  }

  const rows = optimistic ?? accounts;

  function move(index: number, direction: "up" | "down") {
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= rows.length) return;

    const next = [...rows];
    const current = next[index]!;
    next[index] = next[swapWith]!;
    next[swapWith] = current;
    setOptimistic(next);
    setError(null);

    startTransition(async () => {
      const result = await reorderAccountsAction(next.map((row) => row.id));
      if (!result.ok) {
        setOptimistic(null);
        setError(result.error);
        return;
      }
      router.replace(
        `/accounts?notice=${encodeURIComponent("Account order updated")}`,
      );
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-600">
        No accounts yet. Add one below or import a YNAB CSV.
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p className="border-b border-coral-500/20 bg-coral-500/10 px-4 py-2 text-xs font-semibold text-coral-600">
          {error}
        </p>
      ) : null}
      <ul className={`divide-y divide-ink-900/5 ${pending ? "opacity-80" : ""}`}>
        {rows.map((account, index) => (
          <li
            key={account.id}
            className={`flex items-center gap-2 px-4 py-4 transition hover:bg-sand-100 ${
              account.include_in_total ? "" : "opacity-60"
            }`}
          >
            <label
              className="flex shrink-0 cursor-pointer items-center"
              title={
                account.include_in_total
                  ? "Included in All accounts total"
                  : "Excluded from All accounts total"
              }
            >
              <span className="sr-only">
                Include {account.name} in All accounts total
              </span>
              <input
                type="checkbox"
                className="size-4 rounded border-ink-900/20"
                checked={account.include_in_total}
                disabled={pending}
                onChange={(event) => {
                  const include = event.target.checked;
                  const formData = new FormData();
                  formData.set("account_id", account.id);
                  formData.set("include_in_total", include ? "true" : "false");
                  startTransition(async () => {
                    await setAccountIncludeInTotalAction(formData);
                    router.refresh();
                  });
                }}
              />
            </label>
            <Link
              href={`/accounts/${account.id}`}
              className="flex min-w-0 flex-1 items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink-900">{account.name}</p>
                <p className="text-xs uppercase tracking-wide text-ink-600">
                  {account.account_type}
                  {!account.include_in_total ? " · excluded from total" : ""}
                </p>
              </div>
              <p className="shrink-0 font-bold">
                <Money cents={account.balanceCents} />
              </p>
            </Link>
            {canReorder ? (
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={pending || index === 0}
                  onClick={() => move(index, "up")}
                  className={moveBtnClass}
                  aria-label={`Move ${account.name} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={pending || index === rows.length - 1}
                  onClick={() => move(index, "down")}
                  className={moveBtnClass}
                  aria-label={`Move ${account.name} down`}
                >
                  ↓
                </button>
              </div>
            ) : null}
            <DeleteAccountButton
              accountId={account.id}
              accountName={account.name}
              variant="link"
            />
          </li>
        ))}
      </ul>
    </>
  );
}

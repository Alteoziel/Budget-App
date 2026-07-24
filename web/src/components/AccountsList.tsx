"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { Money } from "@/components/Money";
import { setAccountIncludeInTotalAction } from "@/lib/actions";

type AccountRow = {
  id: string;
  name: string;
  account_type: string;
  balanceCents: number;
  include_in_total: boolean;
};

export function AccountsList({ accounts }: { accounts: AccountRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (accounts.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-600">
        No accounts yet. Add one below or import a YNAB CSV.
      </p>
    );
  }

  return (
    <ul className={`divide-y divide-ink-900/5 ${pending ? "opacity-80" : ""}`}>
      {accounts.map((account) => (
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
          <DeleteAccountButton
            accountId={account.id}
            accountName={account.name}
            variant="link"
          />
        </li>
      ))}
    </ul>
  );
}

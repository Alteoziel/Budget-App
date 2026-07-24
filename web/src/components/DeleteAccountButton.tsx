"use client";

import { deleteAccountAction } from "@/lib/actions";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";

export function DeleteAccountButton({
  accountId,
  accountName,
  transactionCount,
  variant = "button",
}: {
  accountId: string;
  accountName: string;
  transactionCount?: number;
  variant?: "button" | "link";
}) {
  const txnNote =
    typeof transactionCount === "number" && transactionCount > 0
      ? ` This also deletes ${transactionCount} transaction${transactionCount === 1 ? "" : "s"}.`
      : " Any transactions on this account will be deleted.";

  return (
    <form
      action={deleteAccountAction}
      onSubmit={(e) => {
        if (
          !confirm(
            `Delete account “${accountName}”?${txnNote} This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="account_id" value={accountId} />
      <PendingSubmitButton
        pendingLabel={variant === "link" ? "…" : "Deleting…"}
        className={
          variant === "link"
            ? "text-xs font-bold text-coral-500 hover:underline"
            : "w-full rounded-2xl bg-coral-500 px-4 py-3 text-sm font-bold text-sand-50 hover:bg-coral-500/90"
        }
      >
        {variant === "link" ? "Delete" : "Delete account"}
      </PendingSubmitButton>
    </form>
  );
}

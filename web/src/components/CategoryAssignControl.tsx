"use client";

import { useRouter } from "next/navigation";
import {
  useBeginLocalBudgetMutation,
  useNotifyBudgetChange,
} from "@/components/BudgetRealtimeProvider";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import { categoryAmountAction } from "@/lib/actions";
import type { BudgetRow } from "@/lib/types";

const btnClass =
  "min-h-11 w-full rounded-xl border border-ink-900/15 bg-white px-2 text-sm font-bold text-ink-800 hover:bg-sand-100";

const primaryBtnClass =
  "min-h-11 w-full rounded-xl bg-moss-500 px-2 text-sm font-bold text-sand-50 hover:bg-moss-400";

export function CategoryAssignControl({
  month,
  row,
}: {
  month: string;
  row: BudgetRow;
}) {
  const router = useRouter();
  const notifyChange = useNotifyBudgetChange();
  const beginLocalMutation = useBeginLocalBudgetMutation();

  return (
    <form
      action={async (formData) => {
        // Arm echo-skip before the write so realtime can't paint a stale RSC
        // snapshot between commit and our own refresh.
        const endLocalMutation = beginLocalMutation();
        try {
          await categoryAmountAction(formData);
          notifyChange();
          router.refresh();
        } finally {
          endLocalMutation();
        }
      }}
      className="mt-2 space-y-2"
    >
      <input type="hidden" name="category_id" value={row.categoryId} />
      <input type="hidden" name="month" value={month} />

      <label className="sr-only" htmlFor={`amount-${row.categoryId}`}>
        Amount
      </label>
      <input
        id={`amount-${row.categoryId}`}
        name="amount"
        inputMode="decimal"
        placeholder="0.00"
        className="min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/15 bg-white px-3 py-2 text-base outline-none ring-moss-400 focus:ring-2"
      />

      <div className="grid grid-cols-3 gap-2">
        <PendingSubmitButton
          name="intent"
          value="add"
          pendingLabel="+"
          className={primaryBtnClass}
        >
          +
        </PendingSubmitButton>
        <PendingSubmitButton name="intent" value="sub" pendingLabel="−" className={btnClass}>
          −
        </PendingSubmitButton>
        <PendingSubmitButton name="intent" value="set" pendingLabel="set" className={btnClass}>
          set
        </PendingSubmitButton>
        <PendingSubmitButton
          name="intent"
          value="auto_percent"
          pendingLabel="auto:%"
          className={btnClass}
        >
          auto:%
        </PendingSubmitButton>
        <PendingSubmitButton
          name="intent"
          value="auto_fixed"
          pendingLabel="auto:#"
          className={btnClass}
        >
          auto:#
        </PendingSubmitButton>
        <PendingSubmitButton
          name="intent"
          value="auto_priority"
          pendingLabel="AP"
          className={btnClass}
          aria-label="Set Auto Priority (AP). Lower numbers fund first; 0 clears."
        >
          AP
        </PendingSubmitButton>
      </div>
    </form>
  );
}

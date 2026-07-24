"use client";

import { Money } from "@/components/Money";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import { categoryAmountAction } from "@/lib/actions";
import type { BudgetRow } from "@/lib/types";

function AutoRuleLabel({ row }: { row: BudgetRow }) {
  if (row.assignMode === "fixed") {
    if (row.assignFixedCents <= 0) {
      return <span className="text-ink-500">Auto off</span>;
    }
    return (
      <span>
        Auto <Money cents={row.assignFixedCents} />
      </span>
    );
  }
  if (row.assignPercent <= 0) {
    return <span className="text-ink-500">Auto off</span>;
  }
  return <span>Auto {row.assignPercent.toFixed(1)}%</span>;
}

const btnClass =
  "rounded-xl border border-ink-900/10 bg-white px-2.5 py-2 text-xs font-bold text-ink-800 hover:bg-sand-100";

export function CategoryAssignControl({
  month,
  row,
}: {
  month: string;
  row: BudgetRow;
}) {
  return (
    <form action={categoryAmountAction} className="mt-3 space-y-2">
      <input type="hidden" name="category_id" value={row.categoryId} />
      <input type="hidden" name="month" value={month} />

      <p className="text-xs text-ink-600">
        Assigned <Money cents={row.assignedCents} />
        <span className="mx-1.5 text-ink-400">·</span>
        <AutoRuleLabel row={row} />
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`amount-${row.categoryId}`}>
          Amount
        </label>
        <input
          id={`amount-${row.categoryId}`}
          name="amount"
          inputMode="decimal"
          placeholder="0.00"
          className="min-h-11 w-28 touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
        />
        <div className="flex flex-wrap gap-1.5">
          <PendingSubmitButton name="intent" value="add" pendingLabel="…" className={btnClass}>
            +
          </PendingSubmitButton>
          <PendingSubmitButton name="intent" value="sub" pendingLabel="…" className={btnClass}>
            −
          </PendingSubmitButton>
          <PendingSubmitButton
            name="intent"
            value="set"
            pendingLabel="…"
            className="rounded-xl bg-moss-500 px-2.5 py-2 text-xs font-bold text-sand-50 hover:bg-moss-400"
          >
            set
          </PendingSubmitButton>
          <PendingSubmitButton
            name="intent"
            value="auto_percent"
            pendingLabel="…"
            className={btnClass}
          >
            auto:%
          </PendingSubmitButton>
          <PendingSubmitButton
            name="intent"
            value="auto_fixed"
            pendingLabel="…"
            className={btnClass}
          >
            auto:#
          </PendingSubmitButton>
        </div>
      </div>
    </form>
  );
}

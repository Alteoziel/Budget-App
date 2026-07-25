"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearCategoryGoalAction, setCategoryGoalAction } from "@/lib/actions";
import { formatCents } from "@/lib/money";
import type { BudgetRow, GoalFrequency } from "@/lib/types";

const FREQUENCIES: Array<{ value: GoalFrequency; label: string }> = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "once", label: "One time" },
];

function frequencyLabel(frequency: GoalFrequency): string {
  return FREQUENCIES.find((f) => f.value === frequency)?.label ?? "Monthly";
}

export function CategoryGoalButton({
  row,
  onExpandClick,
}: {
  row: BudgetRow;
  /** Used when no goal is set — empty space beside “Set goal” expands the row. */
  onExpandClick?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(
    row.goalCents == null ? "" : (row.goalCents / 100).toFixed(2),
  );
  const [goalName, setGoalName] = useState(row.goalName);
  const [frequency, setFrequency] = useState<GoalFrequency>(row.goalFrequency);
  const [note, setNote] = useState(row.goalNote);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasGoal = row.goalCents != null;
  const progressPct =
    hasGoal && row.goalCents! > 0
      ? Math.max(0, Math.min(100, (row.availableCents / row.goalCents!) * 100))
      : 0;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setCategoryGoalAction({
        categoryId: row.categoryId,
        amount,
        goalName,
        frequency,
        note,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function clearGoal() {
    setError(null);
    startTransition(async () => {
      const result = await clearCategoryGoalAction(row.categoryId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAmount("");
      setGoalName("");
      setFrequency("monthly");
      setNote("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {hasGoal ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1.5 block w-full text-left"
        >
          <span className="block rounded-xl border border-moss-500/30 bg-moss-500/10 px-2.5 py-1.5">
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-bold text-ink-900">
                {row.goalName || "Goal"}
              </span>
              <span className="shrink-0 text-sm font-bold text-moss-600">
                {formatCents(row.goalCents!)}
                <span className="text-[11px] font-semibold text-ink-500">
                  {" / "}
                  {frequencyLabel(row.goalFrequency).toLowerCase()}
                </span>
              </span>
            </span>
            {row.goalCents! > 0 ? (
              <>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-ink-900/10">
                  <span
                    className="block h-full rounded-full bg-moss-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </span>
                <span className="mt-1 block text-[11px] font-bold text-ink-600">
                  {progressPct.toFixed(0)}% funded
                </span>
              </>
            ) : null}
          </span>
        </button>
      ) : (
        <div className="mt-1.5 flex items-stretch gap-1">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-9 shrink-0 items-center rounded-xl border border-dashed border-moss-500/40 px-2.5 text-sm font-bold text-moss-500"
          >
            Set goal
          </button>
          {onExpandClick ? (
            <button
              type="button"
              onClick={onExpandClick}
              aria-label={`Expand ${row.categoryName}`}
              className="min-h-9 min-w-0 flex-1 rounded-xl outline-none ring-moss-400 focus-visible:ring-2"
            />
          ) : null}
        </div>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={`Goal for ${row.categoryName}`}
        >
          <div className="w-full max-w-md rounded-3xl bg-sand-50 p-5 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-ink-900">
                  Goal for {row.categoryName}
                </h3>
                <p className="mt-1 text-xs text-ink-600">
                  Everything here is optional. Leave the amount blank to remove the goal.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 shrink-0 px-2 text-sm font-semibold text-ink-600"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-sm font-semibold text-ink-700">
                Goal amount
                <input
                  autoFocus
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="250.00"
                  className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                />
              </label>

              <label className="block text-sm font-semibold text-ink-700">
                Goal name
                <input
                  value={goalName}
                  onChange={(event) => setGoalName(event.target.value)}
                  placeholder="Weekly groceries"
                  maxLength={120}
                  className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                />
              </label>

              <label className="block text-sm font-semibold text-ink-700">
                Frequency
                <select
                  value={frequency}
                  onChange={(event) =>
                    setFrequency(event.target.value as GoalFrequency)
                  }
                  className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                >
                  {FREQUENCIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-semibold text-ink-700">
                Note
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Why this goal matters, or how you picked the number."
                  className="mt-1 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                />
              </label>

              <p className="text-xs text-ink-600">
                Activity this month: {formatCents(row.activityCents)} · Available:{" "}
                {formatCents(row.availableCents)}
              </p>

              {error ? (
                <p className="rounded-xl bg-coral-500/15 px-3 py-2 text-sm font-semibold text-coral-600">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={save}
                  disabled={pending}
                  className="min-h-11 flex-1 rounded-2xl bg-moss-500 px-4 py-2 text-sm font-bold text-sand-50 disabled:opacity-60"
                >
                  {pending ? "Saving…" : "Save goal"}
                </button>
                {hasGoal ? (
                  <button
                    type="button"
                    onClick={clearGoal}
                    disabled={pending}
                    className="min-h-11 rounded-2xl border border-coral-400/40 px-4 py-2 text-sm font-bold text-coral-500"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

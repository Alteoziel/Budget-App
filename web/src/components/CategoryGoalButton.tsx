"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useAnnounceEditing } from "@/components/BudgetRealtimeProvider";
import { clearCategoryGoalAction, setCategoryGoalAction } from "@/lib/actions";
import {
  frequencyPeriodLabel,
  requiredContributionCents,
} from "@/lib/goal-funding";
import { currentIsoDate, formatBudgetDate, formatCents } from "@/lib/money";
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
  const titleId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(
    row.goalCents == null ? "" : (row.goalCents / 100).toFixed(2),
  );
  const [goalName, setGoalName] = useState(row.goalName);
  const [frequency, setFrequency] = useState<GoalFrequency>(row.goalFrequency);
  const [note, setNote] = useState(row.goalNote);
  const [dueOnEnabled, setDueOnEnabled] = useState(Boolean(row.goalDueOn));
  const [dueOn, setDueOn] = useState(row.goalDueOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useAnnounceEditing(
    open
      ? {
          kind: "goal",
          id: row.categoryId,
          label: `goal · ${row.categoryName}`,
        }
      : null,
  );

  const hasGoal = row.goalCents != null;
  const progressPct =
    hasGoal && row.goalCents! > 0
      ? Math.max(0, Math.min(100, (row.availableCents / row.goalCents!) * 100))
      : 0;

  const today = currentIsoDate();

  const draftGoalCents = useMemo(() => {
    const cleaned = amount.replace(/[$,\s]/g, "").trim();
    if (!cleaned) return null;
    const value = Number(cleaned);
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 100);
  }, [amount]);

  const fundingPlan = useMemo(() => {
    if (!dueOnEnabled || !dueOn || draftGoalCents == null) return null;
    return requiredContributionCents({
      goalCents: draftGoalCents,
      availableCents: row.availableCents,
      frequency,
      goalDueOn: dueOn,
      asOfIso: today,
    });
  }, [dueOnEnabled, dueOn, draftGoalCents, row.availableCents, frequency, today]);

  const savedFundingPlan = useMemo(() => {
    if (!row.goalDueOn || row.goalCents == null) return null;
    return requiredContributionCents({
      goalCents: row.goalCents,
      availableCents: row.availableCents,
      frequency: row.goalFrequency,
      goalDueOn: row.goalDueOn,
      asOfIso: today,
    });
  }, [row.goalDueOn, row.goalCents, row.availableCents, row.goalFrequency, today]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus without scrolling the page (autoFocus would jump to the category).
    amountRef.current?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openDialog() {
    setAmount(row.goalCents == null ? "" : (row.goalCents / 100).toFixed(2));
    setGoalName(row.goalName);
    setFrequency(row.goalFrequency);
    setNote(row.goalNote);
    setDueOnEnabled(Boolean(row.goalDueOn));
    setDueOn(row.goalDueOn ?? "");
    setError(null);
    setOpen(true);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setCategoryGoalAction({
        categoryId: row.categoryId,
        amount,
        goalName,
        frequency,
        note,
        dueOnEnabled,
        dueOn,
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
      setDueOnEnabled(false);
      setDueOn("");
      setOpen(false);
      router.refresh();
    });
  }

  const dialog =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div className="max-h-[min(90dvh,40rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-sand-50 p-5 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3
                    id={titleId}
                    className="font-display text-lg font-bold text-ink-900"
                  >
                    Goal for {row.categoryName}
                  </h3>
                  <p className="mt-1 text-xs text-ink-600">
                    Everything here is optional. Leave the amount blank to remove
                    the goal.
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
                    ref={amountRef}
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

                <div className="rounded-xl border border-ink-900/10 bg-white px-3 py-3">
                  <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-ink-700">
                    <span>Due date</span>
                    <input
                      type="checkbox"
                      checked={dueOnEnabled}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setDueOnEnabled(enabled);
                        if (enabled && !dueOn) {
                          setDueOn(today);
                        }
                      }}
                      className="size-5 rounded border-ink-900/20"
                    />
                  </label>
                  {dueOnEnabled ? (
                    <label className="mt-2 block text-xs font-semibold text-ink-600">
                      Target date
                      <input
                        type="date"
                        value={dueOn}
                        min={today}
                        onChange={(event) => setDueOn(event.target.value)}
                        className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-sand-50 px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                      />
                    </label>
                  ) : (
                    <p className="mt-1 text-xs text-ink-600">
                      Turn on to pick a calendar date and auto-calculate how much
                      to fund each {frequencyPeriodLabel(frequency)}.
                    </p>
                  )}
                </div>

                {fundingPlan ? (
                  <div className="rounded-xl border border-moss-500/25 bg-moss-500/10 px-3 py-3 text-sm text-ink-800">
                    <p className="font-bold text-ink-900">
                      {fundingPlan.remainingCents === 0
                        ? "Goal is fully funded"
                        : frequency === "once"
                          ? `Need ${formatCents(fundingPlan.perPeriodCents)} by ${formatBudgetDate(dueOn)}`
                          : `Need ${formatCents(fundingPlan.perPeriodCents)} / ${frequencyPeriodLabel(frequency)}`}
                    </p>
                    {fundingPlan.remainingCents > 0 ? (
                      <p className="mt-1 text-xs text-ink-600">
                        {formatCents(fundingPlan.remainingCents)} left ·{" "}
                        {fundingPlan.periodsLeft}{" "}
                        {frequencyPeriodLabel(frequency)}
                        {fundingPlan.periodsLeft === 1 ? "" : "s"} until{" "}
                        {formatBudgetDate(dueOn)}
                      </p>
                    ) : null}
                  </div>
                ) : null}

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
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {hasGoal ? (
        <button
          type="button"
          onClick={openDialog}
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
                  {savedFundingPlan && savedFundingPlan.remainingCents > 0
                    ? ` · need ${formatCents(savedFundingPlan.perPeriodCents)}/${frequencyPeriodLabel(row.goalFrequency)}`
                    : ""}
                  {row.goalDueOn ? ` · due ${formatBudgetDate(row.goalDueOn)}` : ""}
                </span>
              </>
            ) : null}
          </span>
        </button>
      ) : (
        <div className="mt-1.5 flex items-stretch gap-1">
          <button
            type="button"
            onClick={openDialog}
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
      {dialog}
    </>
  );
}

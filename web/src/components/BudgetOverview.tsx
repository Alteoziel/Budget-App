"use client";

import { useState } from "react";
import { Money } from "@/components/Money";
import { OverspentFixer, type FixerStage } from "@/components/OverspentFixer";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import { autoAssignAction } from "@/lib/actions";
import { formatBudgetMonth } from "@/lib/money";
import type { BudgetRow } from "@/lib/types";

export function BudgetOverview({
  month,
  liveMonth,
  rows,
  readyToAssignCents,
}: {
  month: string;
  liveMonth: string;
  rows: BudgetRow[];
  readyToAssignCents: number;
}) {
  const [stage, setStage] = useState<FixerStage>("idle");
  const shortfall = readyToAssignCents < 0;
  const canAutoAssign = readyToAssignCents > 0;
  const canFix = shortfall || rows.some((row) => row.availableCents < 0);
  const isFutureMonth = month > liveMonth;
  // Sticky only when there’s money left to assign (skip transform animation —
  // it breaks position: sticky).
  const stickyReady = canAutoAssign;

  return (
    <>
      <OverspentFixer
        month={month}
        rows={rows}
        readyToAssignCents={readyToAssignCents}
        stage={stage}
        onStageChange={setStage}
      />

      <section
        className={`flex items-center gap-4 rounded-2xl px-4 py-3 ${
          shortfall ? "hero-panel-alert" : "hero-panel"
        } ${
          stickyReady
            ? "sticky top-[max(0.5rem,env(safe-area-inset-top))] z-40 shadow-soft"
            : "animate-rise"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-80">
            Ready to assign
          </p>
          <p className="font-display text-2xl font-bold leading-tight">
            <Money cents={readyToAssignCents} className="text-inherit" />
          </p>
          {isFutureMonth ? (
            <p className="mt-0.5 text-[11px] font-semibold opacity-75">
              From {formatBudgetMonth(liveMonth)}
            </p>
          ) : null}
        </div>

        {canAutoAssign ? (
          <form action={autoAssignAction} className="shrink-0">
            <input type="hidden" name="month" value={month} />
            <PendingSubmitButton
              pendingLabel="Assigning…"
              className="min-h-11 rounded-xl bg-moss-500 px-4 text-sm font-bold text-sand-50 disabled:opacity-60"
            >
              Auto-assign
            </PendingSubmitButton>
          </form>
        ) : canFix ? (
          <button
            type="button"
            onClick={() => setStage("banner")}
            className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold ${
              shortfall
                ? "bg-sand-50 text-coral-600 dark:bg-ink-900 dark:text-coral-500"
                : "bg-coral-500 text-sand-50"
            }`}
          >
            Fix Now
          </button>
        ) : (
          <p className="shrink-0 text-xs font-semibold opacity-80">All assigned</p>
        )}
      </section>
      {shortfall ? (
        <p className="mt-2 text-xs font-semibold text-coral-600">
          You have assigned more than you have — cover the shortfall before assigning more.
        </p>
      ) : null}
    </>
  );
}

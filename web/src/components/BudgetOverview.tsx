"use client";

import { useState } from "react";
import { Money } from "@/components/Money";
import { OverspentFixer, type FixerStage } from "@/components/OverspentFixer";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import { autoAssignAction } from "@/lib/actions";
import type { BudgetRow } from "@/lib/types";

export function BudgetOverview({
  month,
  rows,
  readyToAssignCents,
}: {
  month: string;
  rows: BudgetRow[];
  readyToAssignCents: number;
}) {
  const [stage, setStage] = useState<FixerStage>("idle");
  const shortfall = readyToAssignCents < 0;
  const canAutoAssign = readyToAssignCents > 0;
  const canFix = shortfall || rows.some((row) => row.availableCents < 0);

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
        className={`animate-rise rounded-3xl px-5 py-5 shadow-soft ${
          shortfall ? "bg-coral-500 text-sand-50" : "bg-ink-900 text-sand-50"
        }`}
      >
        <p
          className={`text-xs font-bold uppercase tracking-[0.18em] ${
            shortfall ? "text-sand-100" : "text-moss-300"
          }`}
        >
          Ready to assign
        </p>
        <p className="mt-2 font-display text-4xl font-bold">
          <Money cents={readyToAssignCents} className="text-sand-50" />
        </p>
        <p className={`mt-2 text-sm ${shortfall ? "text-sand-100" : "text-sand-200"}`}>
          {shortfall
            ? "You have assigned more than you have. Cover the shortfall before assigning more."
            : "Assign dollars to categories until this hits zero — or use Auto-assign with your percentages."}
        </p>

        {canAutoAssign ? (
          <form action={autoAssignAction} className="mt-4">
            <input type="hidden" name="month" value={month} />
            <PendingSubmitButton
              pendingLabel="Assigning…"
              className="min-h-11 w-full rounded-2xl bg-moss-500 px-4 py-3 text-sm font-bold text-sand-50 disabled:opacity-60 sm:w-auto"
            >
              Auto-assign
            </PendingSubmitButton>
          </form>
        ) : canFix ? (
          <button
            type="button"
            onClick={() => setStage("banner")}
            className={`mt-4 min-h-11 w-full rounded-2xl px-4 py-3 text-sm font-bold sm:w-auto ${
              shortfall ? "bg-sand-50 text-coral-600" : "bg-coral-500 text-sand-50"
            }`}
          >
            Fix Now
          </button>
        ) : (
          <p className="mt-4 text-sm font-semibold text-sand-100">
            Nothing to assign right now.
          </p>
        )}
      </section>
    </>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Money } from "@/components/Money";
import { applyOverspendFixAction } from "@/lib/actions";
import { dollarsToCents, formatCents } from "@/lib/money";
import {
  READY_TO_ASSIGN_TARGET_ID,
  allocateDonations,
  groupAllocationsByTarget,
  rankOverspendDonors,
  totalDonatedCents,
  totalShortfallCents,
  type FixDonation,
  type FixTarget,
} from "@/lib/overspend-fix";
import type { BudgetRow } from "@/lib/types";

export type FixerStage = "idle" | "banner" | "collect" | "review";

function asOfIsoForMonth(month: string): string {
  // Budget months are YYYY-MM; score due-date pressure from the 1st of that month.
  if (/^\d{4}-\d{2}$/.test(month)) return `${month}-01`;
  return month.slice(0, 10);
}

export function OverspentFixer({
  month,
  rows,
  readyToAssignCents,
  stage,
  onStageChange,
}: {
  month: string;
  rows: BudgetRow[];
  readyToAssignCents: number;
  stage: FixerStage;
  onStageChange: (stage: FixerStage) => void;
}) {
  const router = useRouter();
  const setStage = onStageChange;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openDonorId, setOpenDonorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const targets = useMemo<FixTarget[]>(() => {
    const overspent = rows
      .filter((row) => row.availableCents < 0)
      .map((row) => ({
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        shortfallCents: -row.availableCents,
      }));
    if (readyToAssignCents < 0) {
      overspent.push({
        categoryId: READY_TO_ASSIGN_TARGET_ID,
        categoryName: "Ready to assign",
        shortfallCents: -readyToAssignCents,
      });
    }
    return overspent;
  }, [rows, readyToAssignCents]);

  const donorRows = useMemo(() => {
    const asOfIso = asOfIsoForMonth(month);
    return rankOverspendDonors(
      rows.filter((row) => row.availableCents > 0),
      asOfIso,
    );
  }, [rows, month]);

  const donations = useMemo<FixDonation[]>(() => {
    const list: FixDonation[] = [];
    for (const row of donorRows) {
      const raw = drafts[row.categoryId];
      if (!raw) continue;
      const cents = dollarsToCents(raw);
      if (cents == null || cents <= 0) continue;
      list.push({
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        cents: Math.min(cents, row.availableCents),
      });
    }
    return list;
  }, [donorRows, drafts]);

  const needCents = totalShortfallCents(targets);
  const pulledCents = totalDonatedCents(donations);
  const remainingCents = Math.max(0, needCents - pulledCents);
  const covered = needCents > 0 && remainingCents === 0;

  const { allocations } = useMemo(
    () => allocateDonations(targets, donations),
    [targets, donations],
  );
  const allocationsByTarget = useMemo(
    () => groupAllocationsByTarget(allocations),
    [allocations],
  );

  const overspentCount = targets.length;
  if (overspentCount === 0) return null;

  function reset() {
    setDrafts({});
    setOpenDonorId(null);
    setError(null);
  }

  function draftError(row: BudgetRow): string | null {
    const raw = drafts[row.categoryId];
    if (!raw) return null;
    const cents = dollarsToCents(raw);
    if (cents == null) return "Enter a dollar amount like 25.00";
    if (cents < 0) return "Use a positive amount";
    if (cents > row.availableCents) {
      return `Only ${formatCents(row.availableCents)} available here`;
    }
    return null;
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await applyOverspendFixAction({
        month,
        donations: donations.map((d) => ({ categoryId: d.categoryId, cents: d.cents })),
        allocations: allocations.map((a) => ({
          fromCategoryId: a.fromCategoryId,
          toCategoryId: a.toCategoryId,
          cents: a.cents,
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      setStage("idle");
      router.refresh();
    });
  }

  return (
    <div className="mb-4">
      {stage === "idle" ? (
        <button
          type="button"
          onClick={() => setStage("banner")}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-coral-400/40 bg-coral-400/15 px-4 py-3 text-left"
        >
          <span className="text-sm font-bold text-coral-600">
            Overspent Categories
          </span>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-coral-500 text-sm font-bold text-sand-50">
            {overspentCount}
          </span>
        </button>
      ) : null}

      {stage === "banner" || stage === "review" ? (
        <div className="animate-rise rounded-3xl border border-coral-400/40 bg-coral-400/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-ink-900">
                Overspent Categories
              </h2>
              <p className="mt-1 text-sm text-ink-600">
                {stage === "review"
                  ? "Check where each shortfall is being covered from, then confirm."
                  : `${formatCents(needCents)} short across ${overspentCount} ${
                      overspentCount === 1 ? "item" : "items"
                    }.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (stage === "review") {
                  setStage("collect");
                  return;
                }
                setStage("idle");
              }}
              className="min-h-11 shrink-0 px-2 text-sm font-semibold text-ink-600"
            >
              {stage === "review" ? "Back" : "Close"}
            </button>
          </div>

          <ul className="mt-3 space-y-2">
            {targets.map((target) => {
              const sources = allocationsByTarget.get(target.categoryId) ?? [];
              return (
                <li
                  key={target.categoryId}
                  className="rounded-2xl bg-sand-50/90 px-3 py-2 ring-1 ring-ink-900/5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-ink-900">{target.categoryName}</p>
                    <p className="shrink-0 font-bold text-coral-500">
                      <Money cents={-target.shortfallCents} />
                    </p>
                  </div>
                  {stage === "review" ? (
                    sources.length ? (
                      <ul className="mt-1 space-y-0.5">
                        {sources.map((source) => (
                          <li
                            key={`${source.fromCategoryId}-${source.toCategoryId}`}
                            className="text-xs font-semibold text-moss-600"
                          >
                            + {formatCents(source.cents)} from {source.fromCategoryName}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs font-semibold text-coral-500">
                        Still uncovered
                      </p>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>

          {error ? (
            <p className="mt-3 rounded-xl bg-coral-500/15 px-3 py-2 text-sm font-semibold text-coral-600">
              {error}
            </p>
          ) : null}

          {stage === "banner" ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStage("collect");
              }}
              className="mt-4 min-h-11 w-full rounded-2xl bg-coral-500 px-4 py-3 text-sm font-bold text-sand-50"
            >
              Fix Now
            </button>
          ) : (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className="min-h-11 flex-1 rounded-2xl bg-moss-500 px-4 py-3 text-sm font-bold text-sand-50 disabled:opacity-60"
              >
                {pending ? "Confirming…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setStage("collect")}
                disabled={pending}
                className="min-h-11 rounded-2xl border border-ink-900/10 bg-sand-50 px-4 py-3 text-sm font-bold text-ink-700"
              >
                Keep editing
              </button>
            </div>
          )}
        </div>
      ) : null}

      {stage === "collect" ? (
        <div className="animate-rise rounded-3xl border border-ink-900/10 bg-sand-50/90 p-4 shadow-soft">
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={!covered}
              onClick={() => {
                if (!covered) return;
                setError(null);
                setStage("review");
              }}
              className={`min-h-11 flex-1 rounded-2xl px-4 py-3 text-sm font-bold ${
                covered
                  ? "bg-moss-500 text-sand-50"
                  : "cursor-not-allowed bg-ink-900/10 text-ink-700"
              }`}
            >
              {covered
                ? "Apply Now"
                : `${formatCents(remainingCents)} left to cover`}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setStage("idle");
              }}
              className="min-h-11 rounded-2xl border border-ink-900/10 bg-white px-4 py-3 text-sm font-bold text-ink-700"
            >
              Cancel
            </button>
          </div>

          <p className="mt-3 text-xs text-ink-600">
            Tap a category to pull money out of it. Suggested first: leftovers after
            goals and buffers — categories still funding toward a due date or Auto
            Priority stay lower in the list.
          </p>

          {error ? (
            <p className="mt-3 rounded-xl bg-coral-500/15 px-3 py-2 text-sm font-semibold text-coral-600">
              {error}
            </p>
          ) : null}

          {donorRows.length === 0 ? (
            <p className="mt-4 text-sm text-ink-600">
              No categories have available money to pull from right now.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-ink-900/5">
              {donorRows.map((row) => {
                const open = openDonorId === row.categoryId;
                const rowError = draftError(row);
                return (
                  <li key={row.categoryId} className="py-2">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenDonorId(open ? null : row.categoryId)
                      }
                      className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink-900">
                          {row.categoryName}
                        </span>
                        <span className="block text-xs text-ink-600">
                          {formatCents(row.availableCents)} available
                        </span>
                      </span>
                      {drafts[row.categoryId] && !rowError ? (
                        <span className="shrink-0 text-sm font-bold text-moss-600">
                          −{drafts[row.categoryId]}
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs font-bold text-moss-500">
                          {open ? "Close" : "Pull"}
                        </span>
                      )}
                    </button>

                    {open ? (
                      <div className="mt-2">
                        <label className="block text-xs font-semibold text-ink-600">
                          Move out of {row.categoryName}
                          <input
                            autoFocus
                            inputMode="decimal"
                            placeholder="25.00"
                            value={drafts[row.categoryId] ?? ""}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [row.categoryId]: event.target.value,
                              }))
                            }
                            className="mt-1 min-h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                          />
                        </label>
                        <p className="mt-1 text-xs text-ink-600">
                          Money you take out of this box is added to Ready to assign, then
                          used to cover overspending.
                        </p>
                        {rowError ? (
                          <p className="mt-1 text-xs font-semibold text-coral-500">
                            {rowError}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-4 text-sm font-semibold text-ink-700">
            Pulled {formatCents(pulledCents)} of {formatCents(needCents)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

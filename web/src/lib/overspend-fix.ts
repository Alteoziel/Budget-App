/** Shared logic for covering overspent categories from other categories. */

import { requiredContributionCents } from "@/lib/goal-funding";
import type { AssignMode, GoalFrequency } from "@/lib/types";

/** Pseudo-target used when Ready to assign itself is negative. */
export const READY_TO_ASSIGN_TARGET_ID = "__ready_to_assign__";

export type FixTarget = {
  categoryId: string;
  categoryName: string;
  shortfallCents: number;
};

export type FixDonation = {
  categoryId: string;
  categoryName: string;
  cents: number;
};

export type FixAllocation = {
  fromCategoryId: string;
  fromCategoryName: string;
  toCategoryId: string;
  toCategoryName: string;
  cents: number;
};

/** Fields used to rank which categories are safest to pull from. */
export type OverspendDonorCandidate = {
  categoryId: string;
  availableCents: number;
  activityCents: number;
  goalCents: number | null;
  goalFrequency: GoalFrequency;
  goalDueOn: string | null;
  assignPriority: number;
  assignMode: AssignMode;
  assignFixedCents: number;
  assignPercent: number;
};

type TransferDonation = Pick<FixDonation, "categoryId" | "cents">;
type TransferAllocation = Pick<
  FixAllocation,
  "fromCategoryId" | "toCategoryId" | "cents"
>;

export function validateOverspendTransferPlan(
  donations: TransferDonation[],
  allocations: TransferAllocation[],
):
  | {
      ok: true;
      donatedByCategory: Map<string, number>;
      allocatedBySource: Map<string, number>;
    }
  | { ok: false; error: string } {
  if (donations.length === 0 || allocations.length === 0) {
    return { ok: false, error: "Nothing to move yet." };
  }

  const donatedByCategory = new Map<string, number>();
  for (const donation of donations) {
    if (
      !donation.categoryId ||
      !Number.isSafeInteger(donation.cents) ||
      donation.cents <= 0
    ) {
      return { ok: false, error: "Donation amounts must be positive whole cents." };
    }
    donatedByCategory.set(
      donation.categoryId,
      (donatedByCategory.get(donation.categoryId) ?? 0) + donation.cents,
    );
  }

  const allocatedBySource = new Map<string, number>();
  for (const allocation of allocations) {
    if (
      !allocation.fromCategoryId ||
      !allocation.toCategoryId ||
      !Number.isSafeInteger(allocation.cents) ||
      allocation.cents <= 0
    ) {
      return {
        ok: false,
        error: "Allocation amounts must be positive whole cents.",
      };
    }
    if (allocation.fromCategoryId === allocation.toCategoryId) {
      return { ok: false, error: "A category cannot fund itself." };
    }
    if (!donatedByCategory.has(allocation.fromCategoryId)) {
      return {
        ok: false,
        error: "Every allocation must come from a donated category.",
      };
    }
    allocatedBySource.set(
      allocation.fromCategoryId,
      (allocatedBySource.get(allocation.fromCategoryId) ?? 0) +
        allocation.cents,
    );
  }

  for (const [categoryId, allocated] of allocatedBySource) {
    if (allocated > (donatedByCategory.get(categoryId) ?? 0)) {
      return {
        ok: false,
        error: "Allocations exceed the money pulled from a category.",
      };
    }
  }

  return { ok: true, donatedByCategory, allocatedBySource };
}

export function totalShortfallCents(targets: FixTarget[]): number {
  return targets.reduce((sum, target) => sum + Math.max(0, target.shortfallCents), 0);
}

export function totalDonatedCents(donations: FixDonation[]): number {
  return donations.reduce((sum, donation) => sum + Math.max(0, donation.cents), 0);
}

/**
 * Higher = safer / better to pull from when covering overspending.
 *
 * Uses structural budget signals only (goals, due-date pressure, auto-assign
 * priority/mode, spending activity vs available). Does not inspect category
 * names or hardcoded lifestyle keywords.
 */
export function overspendDonorSoftnessScore(
  donor: OverspendDonorCandidate,
  asOfIso: string,
): number {
  const available = Math.max(0, Math.round(donor.availableCents));
  if (available <= 0) return Number.NEGATIVE_INFINITY;

  // Mild capacity preference — enough to break ties, not enough to outrank protection.
  let score = Math.log10(available + 1) * 12;

  const goal =
    donor.goalCents != null && Number.isFinite(donor.goalCents) && donor.goalCents > 0
      ? Math.round(donor.goalCents)
      : null;

  if (goal != null) {
    const surplus = available - goal;
    if (surplus > 0) {
      // Fully funded with leftover — excellent donor for the surplus.
      score += 110;
      score += Math.min(70, (surplus / goal) * 50);
    } else {
      // Still short of the goal — protect remaining money.
      const deficitRatio = Math.min(1, -surplus / goal);
      score -= 90 + deficitRatio * 70;
    }

    const plan = requiredContributionCents({
      goalCents: goal,
      availableCents: available,
      frequency: donor.goalFrequency,
      goalDueOn: donor.goalDueOn,
      asOfIso,
    });
    if (plan && plan.remainingCents > 0) {
      // Imminent deadlines get stronger protection than far-away ones.
      score -= Math.min(100, 100 / Math.max(1, plan.periodsLeft));
      if (plan.perPeriodCents > 0) {
        score -= Math.min(55, (plan.perPeriodCents / available) * 45);
      }
    }

    // Long-horizon goals that barely spend this month behave like savings sinks.
    const spentThisMonth = Math.max(0, -Math.round(donor.activityCents));
    if (
      (donor.goalFrequency === "yearly" || donor.goalFrequency === "once") &&
      spentThisMonth < available * 0.08
    ) {
      score -= 50;
    }
  } else {
    // No goal = unstructured buffer; still useful, but less than funded surplus.
    score += 60;

    // Intentional monthly funding without a goal — slightly protect.
    if (donor.assignMode === "fixed" && donor.assignFixedCents > 0) {
      score -= 28;
    } else if (donor.assignMode === "percent" && donor.assignPercent >= 10) {
      score -= 18;
    }
  }

  // Auto Priority: user explicitly queued this category to receive funding.
  if (donor.assignPriority > 0) {
    const urgency = Math.max(0, 12 - donor.assignPriority);
    score -= 75 + urgency * 6;
  }

  return score;
}

/** Sort donors best-to-pull-from first (descending softness, then available). */
export function compareOverspendDonors(
  a: OverspendDonorCandidate,
  b: OverspendDonorCandidate,
  asOfIso: string,
): number {
  const scoreDiff =
    overspendDonorSoftnessScore(b, asOfIso) - overspendDonorSoftnessScore(a, asOfIso);
  if (Math.abs(scoreDiff) > 1e-9) return scoreDiff > 0 ? 1 : -1;
  if (b.availableCents !== a.availableCents) {
    return b.availableCents - a.availableCents;
  }
  return a.categoryId.localeCompare(b.categoryId);
}

export function rankOverspendDonors<T extends OverspendDonorCandidate>(
  donors: T[],
  asOfIso: string,
): T[] {
  return [...donors].sort((a, b) => compareOverspendDonors(a, b, asOfIso));
}

/**
 * Greedily fill each target from the donations, in the order they were entered.
 * Returns the per-pair moves plus what is still missing / left over.
 */
export function allocateDonations(
  targets: FixTarget[],
  donations: FixDonation[],
): {
  allocations: FixAllocation[];
  remainingCents: number;
  leftoverCents: number;
} {
  const pool = donations
    .filter((donation) => donation.cents > 0)
    .map((donation) => ({ ...donation, remaining: donation.cents }));

  const allocations: FixAllocation[] = [];
  let remainingCents = 0;

  for (const target of targets) {
    let need = Math.max(0, target.shortfallCents);
    if (need === 0) continue;

    for (const donor of pool) {
      if (need === 0) break;
      if (donor.remaining <= 0) continue;
      if (donor.categoryId === target.categoryId) continue;

      const take = Math.min(donor.remaining, need);
      donor.remaining -= take;
      need -= take;
      allocations.push({
        fromCategoryId: donor.categoryId,
        fromCategoryName: donor.categoryName,
        toCategoryId: target.categoryId,
        toCategoryName: target.categoryName,
        cents: take,
      });
    }

    remainingCents += need;
  }

  const leftoverCents = pool.reduce((sum, donor) => sum + donor.remaining, 0);

  return { allocations, remainingCents, leftoverCents };
}

export function groupAllocationsByTarget(
  allocations: FixAllocation[],
): Map<string, FixAllocation[]> {
  const map = new Map<string, FixAllocation[]>();
  for (const allocation of allocations) {
    const list = map.get(allocation.toCategoryId) ?? [];
    list.push(allocation);
    map.set(allocation.toCategoryId, list);
  }
  return map;
}

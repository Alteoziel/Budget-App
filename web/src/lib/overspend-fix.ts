/** Shared logic for covering overspent categories from other categories. */

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

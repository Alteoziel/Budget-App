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

/**
 * Distribute Ready-to-Assign cents across categories by percentage shares.
 * Percents are 0–100; leftover cents from flooring go to the highest-percent category.
 */
export type AutoAssignInput = {
  categoryId: string;
  assignPercent: number;
  currentAssignedCents: number;
};

export type AutoAssignResult = {
  categoryId: string;
  assignedCents: number;
  addedCents: number;
};

export function distributeByPercent(
  readyToAssignCents: number,
  categories: AutoAssignInput[],
): { assignments: AutoAssignResult[]; totalAdded: number; error?: string } {
  if (!Number.isFinite(readyToAssignCents) || readyToAssignCents <= 0) {
    return { assignments: [], totalAdded: 0, error: "Nothing ready to assign." };
  }

  const active = categories.filter(
    (c) => Number.isFinite(c.assignPercent) && c.assignPercent > 0,
  );
  if (active.length === 0) {
    return {
      assignments: [],
      totalAdded: 0,
      error: "Set category percentages before auto-assigning.",
    };
  }

  const totalPercent = active.reduce((sum, c) => sum + c.assignPercent, 0);
  if (totalPercent > 100.0001) {
    return {
      assignments: [],
      totalAdded: 0,
      error: `Category percentages total ${totalPercent.toFixed(1)}% (max 100%).`,
    };
  }

  const pool = Math.floor(readyToAssignCents);
  const raw = active.map((c) => {
    const exact = (pool * c.assignPercent) / 100;
    const floor = Math.floor(exact);
    return { ...c, floor, frac: exact - floor };
  });

  let allocated = raw.reduce((sum, r) => sum + r.floor, 0);
  let remainder = Math.min(pool, Math.floor((pool * totalPercent) / 100)) - allocated;

  // Give leftover cents to highest percent first, then fractional part.
  const byPriority = [...raw].sort(
    (a, b) => b.assignPercent - a.assignPercent || b.frac - a.frac,
  );
  const bonus = new Map<string, number>();
  for (const row of byPriority) {
    if (remainder <= 0) break;
    bonus.set(row.categoryId, (bonus.get(row.categoryId) ?? 0) + 1);
    remainder -= 1;
    allocated += 1;
  }

  const assignments: AutoAssignResult[] = raw.map((row) => {
    const added = row.floor + (bonus.get(row.categoryId) ?? 0);
    return {
      categoryId: row.categoryId,
      addedCents: added,
      assignedCents: row.currentAssignedCents + added,
    };
  });

  const totalAdded = assignments.reduce((sum, a) => sum + a.addedCents, 0);
  return { assignments, totalAdded };
}

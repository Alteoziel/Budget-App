/**
 * Distribute Ready-to-Assign cents across categories by percent and/or fixed shares.
 * Desired amounts that exceed the pool return an error rather than silently truncating.
 */

export type AssignMode = "percent" | "fixed";

export type AutoAssignInput = {
  categoryId: string;
  assignMode: AssignMode;
  assignPercent: number;
  assignFixedCents: number;
  currentAssignedCents: number;
};

export type AutoAssignResult = {
  categoryId: string;
  assignedCents: number;
  addedCents: number;
};

function isActive(c: AutoAssignInput): boolean {
  if (c.assignMode === "fixed") {
    return Number.isFinite(c.assignFixedCents) && c.assignFixedCents > 0;
  }
  return Number.isFinite(c.assignPercent) && c.assignPercent > 0;
}

export function distributeByPercent(
  readyToAssignCents: number,
  categories: AutoAssignInput[],
): { assignments: AutoAssignResult[]; totalAdded: number; error?: string } {
  if (!Number.isFinite(readyToAssignCents) || readyToAssignCents <= 0) {
    return { assignments: [], totalAdded: 0, error: "Nothing ready to assign." };
  }

  const active = categories.filter(isActive);
  if (active.length === 0) {
    return {
      assignments: [],
      totalAdded: 0,
      error: "Set auto:% or auto:# on categories before auto-assigning.",
    };
  }

  const pool = Math.floor(readyToAssignCents);
  const percentCats = active.filter((c) => c.assignMode !== "fixed");
  const fixedCats = active.filter((c) => c.assignMode === "fixed");

  const totalPercent = percentCats.reduce((sum, c) => sum + c.assignPercent, 0);
  if (totalPercent > 100.0001) {
    return {
      assignments: [],
      totalAdded: 0,
      error: `Category percentages total ${totalPercent.toFixed(1)}% (max 100%).`,
    };
  }

  const fixedDesired = fixedCats.reduce((sum, c) => sum + Math.floor(c.assignFixedCents), 0);
  const percentBudget = Math.min(pool, Math.floor((pool * totalPercent) / 100));
  if (fixedDesired + percentBudget > pool) {
    return {
      assignments: [],
      totalAdded: 0,
      error: `Auto-assign needs $${((fixedDesired + percentBudget) / 100).toFixed(2)} but only $${(pool / 100).toFixed(2)} is ready.`,
    };
  }

  const rawPercent = percentCats.map((c) => {
    const exact = (pool * c.assignPercent) / 100;
    const floor = Math.floor(exact);
    return { ...c, floor, frac: exact - floor };
  });

  let allocatedPercent = rawPercent.reduce((sum, r) => sum + r.floor, 0);
  let remainder = percentBudget - allocatedPercent;

  const byPriority = [...rawPercent].sort(
    (a, b) => b.assignPercent - a.assignPercent || b.frac - a.frac,
  );
  const bonus = new Map<string, number>();
  for (const row of byPriority) {
    if (remainder <= 0) break;
    bonus.set(row.categoryId, (bonus.get(row.categoryId) ?? 0) + 1);
    remainder -= 1;
    allocatedPercent += 1;
  }

  const assignments: AutoAssignResult[] = [
    ...rawPercent.map((row) => {
      const added = row.floor + (bonus.get(row.categoryId) ?? 0);
      return {
        categoryId: row.categoryId,
        addedCents: added,
        assignedCents: row.currentAssignedCents + added,
      };
    }),
    ...fixedCats.map((row) => {
      const added = Math.floor(row.assignFixedCents);
      return {
        categoryId: row.categoryId,
        addedCents: added,
        assignedCents: row.currentAssignedCents + added,
      };
    }),
  ];

  const totalAdded = assignments.reduce((sum, a) => sum + a.addedCents, 0);
  return { assignments, totalAdded };
}

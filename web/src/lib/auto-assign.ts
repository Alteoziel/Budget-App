/**
 * Distribute Ready-to-Assign cents across categories by percent and/or fixed shares.
 * Desired amounts that exceed the pool return an error rather than silently truncating.
 *
 * Priority mode funds categories in AP order (1 before 2…), filling each toward its
 * goal (or auto:# amount when no goal). Same priorities split evenly.
 */

export type AssignMode = "percent" | "fixed";
export type AutoAssignMode = "regular" | "priority";

export type AutoAssignInput = {
  categoryId: string;
  assignMode: AssignMode;
  assignPercent: number;
  assignFixedCents: number;
  currentAssignedCents: number;
};

export type PriorityAssignInput = {
  categoryId: string;
  /** Lower positive numbers fund first. 0 = excluded. */
  assignPriority: number;
  /** Remaining cents needed to be “full” for this run. */
  needCents: number;
  currentAssignedCents: number;
};

export type AutoAssignResult = {
  categoryId: string;
  assignedCents: number;
  addedCents: number;
};

/**
 * How many cents Priority auto-assign still needs to put into a category.
 * Prefers underfunded goals; otherwise uses auto:# as the amount to add.
 */
export function priorityNeedCents(input: {
  goalCents: number | null | undefined;
  availableCents: number;
  assignFixedCents: number;
}): number {
  if (input.goalCents != null && Number.isFinite(input.goalCents) && input.goalCents > 0) {
    return Math.max(
      0,
      Math.round(input.goalCents) - Math.round(input.availableCents),
    );
  }
  if (Number.isFinite(input.assignFixedCents) && input.assignFixedCents > 0) {
    return Math.floor(input.assignFixedCents);
  }
  return 0;
}

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

/**
 * Fund categories in Auto Priority (AP) order. Within the same priority, split
 * evenly until each is filled or the pool can’t cover everyone — then hand out
 * leftover cents as evenly as possible.
 */
export function distributeByPriority(
  readyToAssignCents: number,
  categories: PriorityAssignInput[],
): { assignments: AutoAssignResult[]; totalAdded: number; error?: string } {
  if (!Number.isFinite(readyToAssignCents) || readyToAssignCents <= 0) {
    return { assignments: [], totalAdded: 0, error: "Nothing ready to assign." };
  }

  const active = categories.filter(
    (c) =>
      Number.isFinite(c.assignPriority) &&
      c.assignPriority > 0 &&
      Number.isFinite(c.needCents) &&
      c.needCents > 0,
  );
  if (active.length === 0) {
    return {
      assignments: [],
      totalAdded: 0,
      error:
        "Set AP on categories and give them a goal (or auto:#) before Priority auto-assign.",
    };
  }

  let pool = Math.floor(readyToAssignCents);
  const added = new Map<string, number>();
  for (const cat of active) added.set(cat.categoryId, 0);

  const remainingNeed = new Map(
    active.map((c) => [c.categoryId, Math.floor(c.needCents)] as const),
  );
  const byId = new Map(active.map((c) => [c.categoryId, c]));

  const priorities = [
    ...new Set(active.map((c) => c.assignPriority)),
  ].sort((a, b) => a - b);

  for (const priority of priorities) {
    if (pool <= 0) break;

    // Stable order within a tier for leftover cent distribution.
    const tier = active
      .filter((c) => c.assignPriority === priority)
      .map((c) => c.categoryId);

    while (pool > 0) {
      const open = tier.filter((id) => (remainingNeed.get(id) ?? 0) > 0);
      if (open.length === 0) break;

      if (pool < open.length) {
        for (let i = 0; i < pool; i += 1) {
          const id = open[i]!;
          added.set(id, (added.get(id) ?? 0) + 1);
          remainingNeed.set(id, (remainingNeed.get(id) ?? 0) - 1);
        }
        pool = 0;
        break;
      }

      const share = Math.floor(pool / open.length);
      let givenThisRound = 0;
      for (const id of open) {
        const need = remainingNeed.get(id) ?? 0;
        const give = Math.min(share, need);
        if (give <= 0) continue;
        added.set(id, (added.get(id) ?? 0) + give);
        remainingNeed.set(id, need - give);
        pool -= give;
        givenThisRound += give;
      }
      // Safety: if nothing moved (shouldn’t happen), stop the tier.
      if (givenThisRound <= 0) break;
    }
  }

  const assignments: AutoAssignResult[] = [...added.entries()]
    .filter(([, cents]) => cents > 0)
    .map(([categoryId, addedCents]) => {
      const current = byId.get(categoryId)?.currentAssignedCents ?? 0;
      return {
        categoryId,
        addedCents,
        assignedCents: current + addedCents,
      };
    });

  const totalAdded = assignments.reduce((sum, a) => sum + a.addedCents, 0);
  if (totalAdded <= 0) {
    return {
      assignments: [],
      totalAdded: 0,
      error: "Nothing to Priority auto-assign.",
    };
  }
  return { assignments, totalAdded };
}

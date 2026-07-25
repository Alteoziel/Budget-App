import assert from "node:assert/strict";
import {
  distributeByPercent,
  distributeByPriority,
  priorityNeedCents,
} from "@/lib/auto-assign";

{
  const result = distributeByPercent(10000, [
    {
      categoryId: "a",
      assignMode: "percent",
      assignPercent: 50,
      assignFixedCents: 0,
      currentAssignedCents: 0,
    },
    {
      categoryId: "b",
      assignMode: "percent",
      assignPercent: 30,
      assignFixedCents: 0,
      currentAssignedCents: 100,
    },
    {
      categoryId: "c",
      assignMode: "percent",
      assignPercent: 20,
      assignFixedCents: 0,
      currentAssignedCents: 0,
    },
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.totalAdded, 10000);
  const byId = Object.fromEntries(result.assignments.map((a) => [a.categoryId, a]));
  assert.equal(byId.a.assignedCents, 5000);
  assert.equal(byId.b.assignedCents, 3100);
  assert.equal(byId.c.assignedCents, 2000);
}

{
  const result = distributeByPercent(100, [
    {
      categoryId: "a",
      assignMode: "percent",
      assignPercent: 33.33,
      assignFixedCents: 0,
      currentAssignedCents: 0,
    },
    {
      categoryId: "b",
      assignMode: "percent",
      assignPercent: 33.33,
      assignFixedCents: 0,
      currentAssignedCents: 0,
    },
    {
      categoryId: "c",
      assignMode: "percent",
      assignPercent: 33.34,
      assignFixedCents: 0,
      currentAssignedCents: 0,
    },
  ]);
  assert.equal(result.totalAdded, 100);
  assert.equal(
    result.assignments.reduce((s, a) => s + a.addedCents, 0),
    100,
  );
}

{
  const empty = distributeByPercent(0, [
    {
      categoryId: "a",
      assignMode: "percent",
      assignPercent: 100,
      assignFixedCents: 0,
      currentAssignedCents: 0,
    },
  ]);
  assert.equal(empty.error, "Nothing ready to assign.");
}

{
  const over = distributeByPercent(1000, [
    {
      categoryId: "a",
      assignMode: "percent",
      assignPercent: 60,
      assignFixedCents: 0,
      currentAssignedCents: 0,
    },
    {
      categoryId: "b",
      assignMode: "percent",
      assignPercent: 50,
      assignFixedCents: 0,
      currentAssignedCents: 0,
    },
  ]);
  assert.match(over.error ?? "", /max 100/);
}

{
  const partial = distributeByPercent(10000, [
    {
      categoryId: "a",
      assignMode: "percent",
      assignPercent: 40,
      assignFixedCents: 0,
      currentAssignedCents: 0,
    },
  ]);
  assert.equal(partial.totalAdded, 4000);
  assert.equal(partial.assignments[0]?.assignedCents, 4000);
}

{
  const mixed = distributeByPercent(10000, [
    {
      categoryId: "rent",
      assignMode: "fixed",
      assignPercent: 0,
      assignFixedCents: 2500,
      currentAssignedCents: 0,
    },
    {
      categoryId: "food",
      assignMode: "percent",
      assignPercent: 50,
      assignFixedCents: 0,
      currentAssignedCents: 100,
    },
  ]);
  assert.equal(mixed.error, undefined);
  assert.equal(mixed.totalAdded, 7500);
  const byId = Object.fromEntries(mixed.assignments.map((a) => [a.categoryId, a]));
  assert.equal(byId.rent.addedCents, 2500);
  assert.equal(byId.food.addedCents, 5000);
  assert.equal(byId.food.assignedCents, 5100);
}

{
  const tooMuch = distributeByPercent(3000, [
    {
      categoryId: "rent",
      assignMode: "fixed",
      assignPercent: 0,
      assignFixedCents: 2000,
      currentAssignedCents: 0,
    },
    {
      categoryId: "food",
      assignMode: "percent",
      assignPercent: 50,
      assignFixedCents: 0,
      currentAssignedCents: 0,
    },
  ]);
  assert.match(tooMuch.error ?? "", /only \$30\.00 is ready/);
}

{
  const fixedOnly = distributeByPercent(5000, [
    {
      categoryId: "a",
      assignMode: "fixed",
      assignPercent: 0,
      assignFixedCents: 1200,
      currentAssignedCents: 50,
    },
  ]);
  assert.equal(fixedOnly.totalAdded, 1200);
  assert.equal(fixedOnly.assignments[0]?.assignedCents, 1250);
}

assert.equal(
  priorityNeedCents({
    goalCents: 10_000,
    availableCents: 2_500,
    assignFixedCents: 999,
  }),
  7_500,
);
assert.equal(
  priorityNeedCents({
    goalCents: null,
    availableCents: 0,
    assignFixedCents: 1_200,
  }),
  1_200,
);
assert.equal(
  priorityNeedCents({
    goalCents: 5_000,
    availableCents: 5_000,
    assignFixedCents: 1_200,
  }),
  0,
);

{
  // Fill priority 1 fully before priority 2.
  const result = distributeByPriority(10_000, [
    {
      categoryId: "rent",
      assignPriority: 1,
      needCents: 7_000,
      currentAssignedCents: 100,
    },
    {
      categoryId: "fun",
      assignPriority: 2,
      needCents: 5_000,
      currentAssignedCents: 0,
    },
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.totalAdded, 10_000);
  const byId = Object.fromEntries(result.assignments.map((a) => [a.categoryId, a]));
  assert.equal(byId.rent.addedCents, 7_000);
  assert.equal(byId.rent.assignedCents, 7_100);
  assert.equal(byId.fun.addedCents, 3_000);
}

{
  // Same priority splits evenly until filled.
  const result = distributeByPriority(10_000, [
    {
      categoryId: "a",
      assignPriority: 1,
      needCents: 8_000,
      currentAssignedCents: 0,
    },
    {
      categoryId: "b",
      assignPriority: 1,
      needCents: 8_000,
      currentAssignedCents: 0,
    },
  ]);
  assert.equal(result.totalAdded, 10_000);
  const byId = Object.fromEntries(result.assignments.map((a) => [a.categoryId, a]));
  assert.equal(byId.a.addedCents, 5_000);
  assert.equal(byId.b.addedCents, 5_000);
}

{
  // Uneven needs at the same priority: fill the smaller one, keep splitting.
  const result = distributeByPriority(10_000, [
    {
      categoryId: "a",
      assignPriority: 1,
      needCents: 3_000,
      currentAssignedCents: 0,
    },
    {
      categoryId: "b",
      assignPriority: 1,
      needCents: 8_000,
      currentAssignedCents: 0,
    },
  ]);
  assert.equal(result.totalAdded, 10_000);
  const byId = Object.fromEntries(result.assignments.map((a) => [a.categoryId, a]));
  assert.equal(byId.a.addedCents, 3_000);
  assert.equal(byId.b.addedCents, 7_000);
}

{
  // Leftover cents that can’t cover everyone go out as evenly as possible.
  const result = distributeByPriority(5, [
    {
      categoryId: "a",
      assignPriority: 1,
      needCents: 100,
      currentAssignedCents: 0,
    },
    {
      categoryId: "b",
      assignPriority: 1,
      needCents: 100,
      currentAssignedCents: 0,
    },
    {
      categoryId: "c",
      assignPriority: 1,
      needCents: 100,
      currentAssignedCents: 0,
    },
  ]);
  assert.equal(result.totalAdded, 5);
  const byId = Object.fromEntries(result.assignments.map((a) => [a.categoryId, a]));
  assert.equal(byId.a.addedCents, 2);
  assert.equal(byId.b.addedCents, 2);
  assert.equal(byId.c.addedCents, 1);
}

{
  const empty = distributeByPriority(5_000, [
    {
      categoryId: "a",
      assignPriority: 0,
      needCents: 1_000,
      currentAssignedCents: 0,
    },
  ]);
  assert.match(empty.error ?? "", /Set AP/);
}

console.log("auto-assign.test.ts: ok");

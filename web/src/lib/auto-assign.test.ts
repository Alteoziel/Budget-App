import assert from "node:assert/strict";
import { distributeByPercent } from "@/lib/auto-assign";

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

console.log("auto-assign.test.ts: ok");

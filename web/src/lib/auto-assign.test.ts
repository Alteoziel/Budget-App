import assert from "node:assert/strict";
import { distributeByPercent } from "@/lib/auto-assign";

{
  const result = distributeByPercent(10000, [
    { categoryId: "a", assignPercent: 50, currentAssignedCents: 0 },
    { categoryId: "b", assignPercent: 30, currentAssignedCents: 100 },
    { categoryId: "c", assignPercent: 20, currentAssignedCents: 0 },
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
    { categoryId: "a", assignPercent: 33.33, currentAssignedCents: 0 },
    { categoryId: "b", assignPercent: 33.33, currentAssignedCents: 0 },
    { categoryId: "c", assignPercent: 33.34, currentAssignedCents: 0 },
  ]);
  assert.equal(result.totalAdded, 100);
  assert.equal(
    result.assignments.reduce((s, a) => s + a.addedCents, 0),
    100,
  );
}

{
  const empty = distributeByPercent(0, [
    { categoryId: "a", assignPercent: 100, currentAssignedCents: 0 },
  ]);
  assert.equal(empty.error, "Nothing ready to assign.");
}

{
  const over = distributeByPercent(1000, [
    { categoryId: "a", assignPercent: 60, currentAssignedCents: 0 },
    { categoryId: "b", assignPercent: 50, currentAssignedCents: 0 },
  ]);
  assert.match(over.error ?? "", /max 100/);
}

{
  const partial = distributeByPercent(10000, [
    { categoryId: "a", assignPercent: 40, currentAssignedCents: 0 },
  ]);
  assert.equal(partial.totalAdded, 4000);
  assert.equal(partial.assignments[0]?.assignedCents, 4000);
}

console.log("auto-assign.test.ts: ok");

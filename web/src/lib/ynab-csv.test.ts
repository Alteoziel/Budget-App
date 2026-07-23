import assert from "node:assert/strict";
import {
  parseYnabDate,
  parseYnabRegisterCsv,
  ynabRowFingerprint,
} from "@/lib/ynab-csv";

const sample = `Account,Date,Payee,Category Group/Category,Memo,Outflow,Inflow
Checking,07/01/2026,Payroll,Inflow: Ready to Assign,,,$2500.00
Checking,07/02/2026,Market,Everyday:Groceries,Weekly,$84.12,
Credit Card,07/03/2026,Cafe,Everyday:Coffee,,$4.50,
Checking,02/31/2026,Bad Date,Everyday:Groceries,,$1.00,
Checking,07/04/2026,Both,Everyday:Groceries,,$1.00,$2.00
Checking,07/05/2026,Bad Money,Everyday:Groceries,,$12abc,
`;

const result = parseYnabRegisterCsv(sample);

assert.equal(result.rows.length, 3);
assert.equal(result.rows[0].amountCents, 250000);
assert.equal(result.rows[1].amountCents, -8412);
assert.equal(result.rows[1].categoryGroup, "Everyday");
assert.equal(result.rows[1].categoryName, "Groceries");
assert.equal(result.rows[2].accountName, "Credit Card");
assert.ok(result.errors.some((e) => e.includes("bad date")));
assert.ok(result.errors.some((e) => e.includes("both Inflow and Outflow")));
assert.ok(result.errors.some((e) => e.includes("invalid money")));

assert.equal(parseYnabDate("2026-02-28"), "2026-02-28");
assert.equal(parseYnabDate("2026-02-31"), null);
assert.equal(parseYnabDate("02/28/2026"), "2026-02-28");
assert.equal(parseYnabDate("13/01/2026"), null);
assert.equal(parseYnabDate("July 1, 2026"), null);

const fp = ynabRowFingerprint(result.rows[1]);
assert.equal(
  fp,
  "checking|2026-07-02|market|weekly|-8412|everyday|groceries",
);

console.log("ynab-csv.test.ts: ok");

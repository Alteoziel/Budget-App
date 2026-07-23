import assert from "node:assert/strict";
import { parseYnabRegisterCsv } from "@/lib/ynab-csv";

const sample = `Account,Date,Payee,Category Group/Category,Memo,Outflow,Inflow
Checking,07/01/2026,Payroll,Inflow: Ready to Assign,,,$2500.00
Checking,07/02/2026,Market,Everyday:Groceries,Weekly,$84.12,
Credit Card,07/03/2026,Cafe,Everyday:Coffee,,$4.50,
`;

const result = parseYnabRegisterCsv(sample);

assert.equal(result.rows.length, 3);
assert.equal(result.rows[0].amountCents, 250000);
assert.equal(result.rows[1].amountCents, -8412);
assert.equal(result.rows[1].categoryGroup, "Everyday");
assert.equal(result.rows[1].categoryName, "Groceries");
assert.equal(result.rows[2].accountName, "Credit Card");

console.log("ynab-csv.test.ts: ok");

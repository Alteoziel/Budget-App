import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  detectYnabCsvKind,
  findReflectMasterIndexes,
  parseReflectMonthHeader,
  parseYnabCsv,
  parseYnabDate,
  parseYnabRegisterCsv,
  ynabRowFingerprint,
} from "@/lib/ynab-csv";

const registerSample = `Account,Date,Payee,Category Group/Category,Memo,Outflow,Inflow
Checking,07/01/2026,Payroll,Inflow: Ready to Assign,,,$2500.00
Checking,07/02/2026,Market,Everyday:Groceries,Weekly,$84.12,
Credit Card,07/03/2026,Cafe,Everyday:Coffee,,$4.50,
Checking,02/31/2026,Bad Date,Everyday:Groceries,,$1.00,
Checking,07/04/2026,Both,Everyday:Groceries,,$1.00,$2.00
Checking,07/05/2026,Bad Money,Everyday:Groceries,,$12abc,
`;

const registerResult = parseYnabRegisterCsv(registerSample);
assert.equal(registerResult.kind, "register");
assert.equal(registerResult.rows.length, 3);
assert.equal(registerResult.rows[0].amountCents, 250000);
assert.equal(registerResult.rows[1].amountCents, -8412);
assert.equal(registerResult.rows[1].categoryGroup, "Everyday");
assert.equal(registerResult.rows[1].categoryName, "Groceries");
assert.equal(registerResult.rows[2].accountName, "Credit Card");
assert.ok(registerResult.errors.some((e) => e.includes("bad date")));
assert.ok(registerResult.errors.some((e) => e.includes("both Inflow and Outflow")));
assert.ok(registerResult.errors.some((e) => e.includes("invalid money")));

assert.equal(parseYnabDate("2026-02-28"), "2026-02-28");
assert.equal(parseYnabDate("2026-02-31"), null);
assert.equal(parseYnabDate("02/28/2026"), "2026-02-28");
assert.equal(parseYnabDate("13/01/2026"), null);
assert.equal(parseYnabDate("July 1, 2026"), null);

assert.equal(parseReflectMonthHeader("Jan 2025"), "2025-01-01");
assert.equal(parseReflectMonthHeader("Dec 2024"), "2024-12-01");
assert.equal(parseReflectMonthHeader("Average"), null);
assert.equal(parseReflectMonthHeader("Total"), null);

assert.deepEqual(
  [...findReflectMasterIndexes([-100, -40, -60, -50, -20, -30])].sort((a, b) => a - b),
  [0, 3],
);

const reflectSample = `"Category","Dec 2024","Jan 2025","Average","Total"
"All Income Sources",100.00,200.00,150.00,300.00
"Payroll",100.00,150.00,125.00,250.00
"Side Gig",0.00,50.00,25.00,50.00
"Total Income",100.00,200.00,150.00,300.00
"Uncategorized Transactions",0.00,-5.00,-2.50,-5.00
"Bills",-80.00,-90.00,-85.00,-170.00
"Rent",-70.00,-80.00,-75.00,-150.00
"Utilities",-10.00,-10.00,-10.00,-20.00
"Needs",-20.00,-30.00,-25.00,-50.00
"Groceries",-20.00,-30.00,-25.00,-50.00
"Total Expenses",-100.00,-125.00,-112.50,-225.00
"Net Income",0.00,75.00,37.50,75.00
`;

assert.equal(detectYnabCsvKind(["Category", "Jan 2025", "Total"]), "reflect");
assert.equal(
  detectYnabCsvKind(["Account", "Date", "Payee", "Outflow", "Inflow"]),
  "register",
);

const reflectResult = parseYnabCsv(reflectSample);
assert.equal(reflectResult.kind, "reflect");
assert.ok(reflectResult.rows.length > 0);

// Income payees become uncategorized inflows (Bills/Needs masters skipped).
const payrollJan = reflectResult.rows.find(
  (row) => row.payee === "Payroll" && row.occurredOn === "2025-01-01",
);
assert.ok(payrollJan);
assert.equal(payrollJan!.amountCents, 15000);
assert.equal(payrollJan!.categoryName, "");

const rentDec = reflectResult.rows.find(
  (row) => row.categoryName === "Rent" && row.occurredOn === "2024-12-01",
);
assert.ok(rentDec);
assert.equal(rentDec!.amountCents, -7000);
assert.equal(rentDec!.categoryGroup, "Bills");

assert.equal(
  reflectResult.rows.some((row) => row.categoryName === "Bills"),
  false,
  "master category Bills should not become transactions",
);

const groceries = reflectResult.rows.filter((row) => row.categoryName === "Groceries");
assert.equal(groceries.length, 2);
assert.equal(groceries[0]!.categoryGroup, "Needs");

const fp = ynabRowFingerprint(registerResult.rows[1]!);
assert.equal(
  fp,
  "checking|2026-07-02|market|weekly|-8412|everyday|groceries",
);

// Full real Reflect export from the user, when present in the uploads folder.
try {
  const realPath =
    "/home/ubuntu/.cursor/projects/workspace/uploads/ynab-reflect-income-expense-2026-07-23_5bee.csv";
  const realCsv = readFileSync(realPath, "utf8");
  const real = parseYnabCsv(realCsv);
  assert.equal(real.kind, "reflect");
  assert.ok(real.rows.length > 100, `expected many rows, got ${real.rows.length}`);
  assert.ok(real.rows.some((row) => row.categoryName.includes("Groceries")));
  assert.ok(real.rows.some((row) => row.payee.toLowerCase().includes("payroll") || row.payee.includes("Southern")));
  assert.equal(real.rows.some((row) => row.categoryName === "Bills"), false);
  assert.equal(real.rows.some((row) => row.categoryName === "Needs"), false);
  assert.equal(real.rows.some((row) => row.payee === "Total Income"), false);
  console.log(`real reflect fixture: ${real.rows.length} transaction rows`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

console.log("ynab-csv.test.ts: ok");

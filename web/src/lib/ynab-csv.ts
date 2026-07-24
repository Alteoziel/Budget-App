import Papa from "papaparse";
import { z } from "zod";
import { dollarsToCents } from "@/lib/money";

const registerRowSchema = z.object({
  Account: z.string().optional().default(""),
  Date: z.string().min(1),
  Payee: z.string().optional().default(""),
  "Category Group/Category": z.string().optional(),
  Category: z.string().optional(),
  Memo: z.string().optional().default(""),
  Outflow: z.string().optional().default(""),
  Inflow: z.string().optional().default(""),
});

export type ParsedYnabRow = {
  accountName: string;
  occurredOn: string;
  payee: string;
  categoryGroup: string;
  categoryName: string;
  memo: string;
  amountCents: number;
};

export type ParseYnabResult = {
  rows: ParsedYnabRow[];
  skipped: number;
  errors: string[];
  kind: "register" | "reflect" | "unknown";
};

const MONTH_NAME_TO_NUM: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

const REFLECT_SKIP_ROWS = new Set([
  "all income sources",
  "total income",
  "total expenses",
  "net income",
]);

function normalizeHeader(header: string): string {
  return header.trim().replace(/^\uFEFF/, "");
}

function isValidUtcYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function ymd(year: number, month: number, day: number): string | null {
  if (!isValidUtcYmd(year, month, day)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse YNAB register dates; rejects impossible calendar days; no TZ-shifting fallback. */
export function parseYnabDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(value);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    let year = Number(us[3]);
    if (us[3].length === 2) {
      year = year > 70 ? 1900 + year : 2000 + year;
    }
    return ymd(year, month, day);
  }

  return null;
}

/** "Jan 2025" → 2025-01-01 */
export function parseReflectMonthHeader(header: string): string | null {
  const match = /^([A-Za-z]{3})\s+(\d{4})$/.exec(header.trim());
  if (!match) return null;
  const month = MONTH_NAME_TO_NUM[match[1]];
  if (!month) return null;
  return ymd(Number(match[2]), month, 1);
}

function splitCategory(raw: string | undefined): { group: string; category: string } {
  const value = (raw ?? "").trim();
  if (!value || value === "Inflow: Ready to Assign" || value === "Ready to Assign") {
    return { group: "", category: "" };
  }
  const sep = value.includes(":") ? ":" : value.includes("/") ? "/" : null;
  if (!sep) return { group: "Imported", category: value };
  const [group, ...rest] = value.split(sep);
  const category = rest.join(sep).trim();
  return {
    group: group.trim() || "Imported",
    category: category || group.trim(),
  };
}

function parseMoneyCell(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (!value) return 0;
  return dollarsToCents(value);
}

export function detectYnabCsvKind(
  headers: string[] | undefined,
): ParseYnabResult["kind"] {
  const fields = (headers ?? []).map(normalizeHeader);
  if (!fields.length) return "unknown";

  const hasRegisterShape =
    fields.includes("Date") &&
    (fields.includes("Outflow") || fields.includes("Inflow") || fields.includes("Account"));
  if (hasRegisterShape) return "register";

  const hasReflectShape =
    fields[0] === "Category" &&
    fields.includes("Total") &&
    fields.some((field) => parseReflectMonthHeader(field) !== null);
  if (hasReflectShape) return "reflect";

  return "unknown";
}

/**
 * Master-category (group) rows in Reflect roll up their children totals.
 * Mark indexes whose Total equals the sum of one or more immediately following rows.
 */
export function findReflectMasterIndexes(totalsCents: number[]): Set<number> {
  const masters = new Set<number>();
  let i = 0;
  while (i < totalsCents.length) {
    const total = totalsCents[i]!;
    if (total === 0) {
      i += 1;
      continue;
    }
    let sum = 0;
    let matched = false;
    for (let j = i + 1; j < totalsCents.length; j += 1) {
      sum += totalsCents[j]!;
      if (sum === total) {
        masters.add(i);
        i = j + 1;
        matched = true;
        break;
      }
      // Overshot in the same direction — not a parent of the following block.
      if (Math.abs(sum) > Math.abs(total) && Math.sign(sum) === Math.sign(total)) {
        break;
      }
    }
    if (!matched) i += 1;
  }
  return masters;
}

function parseRegisterRows(csvText: string, parseErrors: string[]): ParseYnabResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });

  const rows: ParsedYnabRow[] = [];
  let skipped = 0;
  const errors: string[] = [
    ...parseErrors,
    ...(parsed.errors.map((e) => e.message) ?? []),
  ];

  for (const [index, raw] of (parsed.data ?? []).entries()) {
    const result = registerRowSchema.safeParse(raw);
    if (!result.success) {
      skipped += 1;
      errors.push(`Row ${index + 2}: invalid columns`);
      continue;
    }

    const data = result.data;
    const occurredOn = parseYnabDate(data.Date);
    if (!occurredOn) {
      skipped += 1;
      errors.push(`Row ${index + 2}: bad date "${data.Date}"`);
      continue;
    }

    const outflowRaw = (data.Outflow || "").trim();
    const inflowRaw = (data.Inflow || "").trim();
    const outflow = parseMoneyCell(outflowRaw);
    const inflow = parseMoneyCell(inflowRaw);
    if (outflow === null || inflow === null) {
      skipped += 1;
      errors.push(`Row ${index + 2}: invalid money amount`);
      continue;
    }

    const outflowAbs = Math.abs(outflow);
    const inflowAbs = Math.abs(inflow);
    if (outflowAbs > 0 && inflowAbs > 0) {
      skipped += 1;
      errors.push(`Row ${index + 2}: both Inflow and Outflow are set`);
      continue;
    }

    const amountCents = inflowAbs - outflowAbs;
    if (amountCents === 0 && !data.Payee && !(data.Memo || "").trim()) {
      skipped += 1;
      continue;
    }

    const categoryRaw = data["Category Group/Category"] || data.Category || "";
    const { group, category } = splitCategory(categoryRaw);

    rows.push({
      accountName: (data.Account || "Imported").trim() || "Imported",
      occurredOn,
      payee: (data.Payee || "").trim(),
      categoryGroup: group,
      categoryName: category,
      memo: (data.Memo || "").trim(),
      amountCents,
    });
  }

  return { rows, skipped, errors: errors.slice(0, 25), kind: "register" };
}

function parseReflectRows(csvText: string, parseErrors: string[]): ParseYnabResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });

  const headers = (parsed.meta.fields ?? []).map(normalizeHeader);
  const monthHeaders = headers
    .map((header) => ({ header, occurredOn: parseReflectMonthHeader(header) }))
    .filter((entry): entry is { header: string; occurredOn: string } => Boolean(entry.occurredOn));

  const errors: string[] = [
    ...parseErrors,
    ...(parsed.errors.map((e) => e.message) ?? []),
  ];
  if (monthHeaders.length === 0) {
    return {
      rows: [],
      skipped: 0,
      errors: [...errors, "No month columns found (expected e.g. Jan 2025)"],
      kind: "reflect",
    };
  }

  type ReflectLine = {
    name: string;
    totalCents: number;
    months: Array<{ occurredOn: string; amountCents: number }>;
  };

  const lines: ReflectLine[] = [];
  let skipped = 0;

  for (const [index, raw] of (parsed.data ?? []).entries()) {
    const name = String(raw.Category ?? "").trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    if (REFLECT_SKIP_ROWS.has(name.toLowerCase())) {
      skipped += 1;
      continue;
    }

    const totalRaw = String(raw.Total ?? "").trim();
    const totalCents = totalRaw ? dollarsToCents(totalRaw) : 0;
    if (totalCents === null) {
      skipped += 1;
      errors.push(`Row ${index + 2}: invalid Total for "${name}"`);
      continue;
    }

    const months: ReflectLine["months"] = [];
    let monthParseFailed = false;
    for (const { header, occurredOn } of monthHeaders) {
      const cell = String(raw[header] ?? "").trim();
      if (!cell || cell === "0" || cell === "0.00" || cell === "-0.00") continue;
      const amountCents = dollarsToCents(cell);
      if (amountCents === null) {
        monthParseFailed = true;
        errors.push(`Row ${index + 2}: invalid amount in ${header} for "${name}"`);
        break;
      }
      if (amountCents === 0) continue;
      months.push({ occurredOn, amountCents });
    }
    if (monthParseFailed) {
      skipped += 1;
      continue;
    }

    lines.push({ name, totalCents: totalCents ?? 0, months });
  }

  // Split income (payee) rows vs expense (category) rows using section markers in the original file.
  // After skipping summary rows, income payees come first until we hit expense territory.
  // Use original order: find first expense-section marker among names we kept.
  const uncategorizedIndex = lines.findIndex(
    (line) => line.name.toLowerCase() === "uncategorized transactions",
  );
  // Fallback: first master-category block (Bills/Needs/etc.) — detect via master indexes on full list.
  // Prefer explicit Uncategorized / first known master-looking boundary.
  let expenseStart = uncategorizedIndex >= 0 ? uncategorizedIndex : -1;
  if (expenseStart < 0) {
    // Heuristic: first row that is a master of following rows starts the category section.
    const masters = findReflectMasterIndexes(lines.map((line) => line.totalCents));
    expenseStart = masters.size ? Math.min(...masters) : lines.length;
  }

  const incomeLines = lines.slice(0, Math.max(0, expenseStart));
  const expenseLines = lines.slice(Math.max(0, expenseStart));
  const masterIndexes = findReflectMasterIndexes(expenseLines.map((line) => line.totalCents));

  // Map each leaf expense index → parent group name (nearest preceding master).
  const groupForLeaf = new Map<number, string>();
  let currentGroup = "Imported";
  for (let i = 0; i < expenseLines.length; i += 1) {
    if (masterIndexes.has(i)) {
      currentGroup = expenseLines[i]!.name;
      continue;
    }
    groupForLeaf.set(i, currentGroup);
  }

  const rows: ParsedYnabRow[] = [];

  for (const line of incomeLines) {
    for (const month of line.months) {
      rows.push({
        accountName: "Imported",
        occurredOn: month.occurredOn,
        payee: line.name === "[No Payee]" ? "" : line.name,
        categoryGroup: "",
        categoryName: "",
        memo: "YNAB Reflect income",
        amountCents: month.amountCents,
      });
    }
  }

  for (let i = 0; i < expenseLines.length; i += 1) {
    if (masterIndexes.has(i)) {
      skipped += 1;
      continue;
    }
    const line = expenseLines[i]!;
    const isUncategorized = line.name.toLowerCase() === "uncategorized transactions";
    const group = isUncategorized ? "" : (groupForLeaf.get(i) ?? "Imported");
    const categoryName = isUncategorized ? "" : line.name;

    for (const month of line.months) {
      rows.push({
        accountName: "Imported",
        occurredOn: month.occurredOn,
        payee: "",
        categoryGroup: group,
        categoryName,
        memo: "YNAB Reflect expense",
        amountCents: month.amountCents,
      });
    }
  }

  return { rows, skipped, errors: errors.slice(0, 25), kind: "reflect" };
}

/** Auto-detect register vs Reflect Income/Expense CSV and parse into transaction rows. */
export function parseYnabCsv(csvText: string): ParseYnabResult {
  const preview = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    preview: 1,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });
  const kind = detectYnabCsvKind(preview.meta.fields);
  const previewErrors = preview.errors.map((e) => e.message);

  if (kind === "register") return parseRegisterRows(csvText, previewErrors);
  if (kind === "reflect") return parseReflectRows(csvText, previewErrors);

  return {
    rows: [],
    skipped: 0,
    errors: [
      ...previewErrors,
      "Unrecognized CSV. Use a YNAB register export or Reflect Income vs Expense export.",
    ],
    kind: "unknown",
  };
}

/** Alias that auto-detects register vs Reflect formats. */
export function parseYnabRegisterCsv(csvText: string): ParseYnabResult {
  return parseYnabCsv(csvText);
}

/** Deterministic fingerprint for import idempotency across fresh CSV exports. */
export function ynabRowFingerprint(row: ParsedYnabRow): string {
  return [
    row.accountName.trim().toLowerCase(),
    row.occurredOn,
    row.payee.trim().toLowerCase(),
    row.memo.trim().toLowerCase(),
    String(row.amountCents),
    row.categoryGroup.trim().toLowerCase(),
    row.categoryName.trim().toLowerCase(),
  ].join("|");
}

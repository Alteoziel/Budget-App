/** Strict money parse: returns null for invalid / ambiguous input. */
export function dollarsToCents(value: string | number): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }

  const cleaned = value.replace(/[$,\s]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "+") return null;

  const negative = cleaned.startsWith("(") && cleaned.endsWith(")");
  let numeric = negative ? cleaned.slice(1, -1).trim() : cleaned;
  if (numeric.startsWith("+")) numeric = numeric.slice(1);
  const signedNegative = numeric.startsWith("-");
  if (signedNegative) numeric = numeric.slice(1);

  // Require a plain decimal with at most 2 fractional digits (no trailing junk).
  if (!/^\d+(\.\d{1,2})?$/.test(numeric)) return null;

  const [whole, frac = ""] = numeric.split(".");
  const cents =
    Number.parseInt(whole, 10) * 100 +
    Number.parseInt(frac.padEnd(2, "0") || "0", 10);
  if (!Number.isFinite(cents)) return null;

  return negative || signedNegative ? -cents : cents;
}

export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function currentBudgetMonth(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

const BUDGET_MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isBudgetMonth(month: string): boolean {
  const match = BUDGET_MONTH_RE.exec(month);
  if (!match) return false;
  const m = Number(match[2]);
  return m >= 1 && m <= 12;
}

/** Inclusive start / exclusive end ISO dates for a YYYY-MM budget month. */
export function budgetMonthDateRange(month: string): {
  start: string;
  endExclusive: string;
} | null {
  if (!isBudgetMonth(month)) return null;
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr);
  const start = `${yearStr}-${monthStr}-01`;
  const nextYear = monthIndex === 12 ? year + 1 : year;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  const endExclusive = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, endExclusive };
}

export function formatBudgetMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  if (!year || !m) return month;
  return new Date(year, m - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** Previous YYYY-MM budget month, or null if invalid. */
export function previousBudgetMonth(month: string): string | null {
  if (!isBudgetMonth(month)) return null;
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const m = Number(monthStr);
  if (m === 1) return `${year - 1}-12`;
  return `${yearStr}-${String(m - 1).padStart(2, "0")}`;
}

/** Next YYYY-MM budget month, or null if invalid. */
export function nextBudgetMonth(month: string): string | null {
  if (!isBudgetMonth(month)) return null;
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const m = Number(monthStr);
  if (m === 12) return `${year + 1}-01`;
  return `${yearStr}-${String(m + 1).padStart(2, "0")}`;
}

/** YYYY-MM containing an ISO date. */
export function budgetMonthFromDate(date: string): string | null {
  if (!isValidIsoDate(date)) return null;
  return date.slice(0, 7);
}

/** Friendly label for a calendar day, e.g. "Jul 15, 2026". */
export function formatBudgetDate(date: string): string {
  if (!isValidIsoDate(date)) return date;
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Local today as YYYY-MM-DD. */
export function currentIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

/** Validate a calendar YYYY-MM-DD date (no timezone shifting). */
export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  return isValidUtcYmd(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function dollarsToCents(value: string | number): number {
  if (typeof value === "number") {
    return Math.round(value * 100);
  }
  const cleaned = value.replace(/[$,\s]/g, "").trim();
  if (!cleaned || cleaned === "-") return 0;
  const negative = cleaned.startsWith("(") && cleaned.endsWith(")");
  const numeric = negative ? cleaned.slice(1, -1) : cleaned.replace(/^\+/, "");
  const parsed = Number.parseFloat(numeric);
  if (Number.isNaN(parsed)) return 0;
  const cents = Math.round(Math.abs(parsed) * 100);
  return negative || cleaned.startsWith("-") ? -cents : cents;
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

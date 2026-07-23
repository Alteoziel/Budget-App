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

export function formatBudgetMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  if (!year || !m) return month;
  return new Date(year, m - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

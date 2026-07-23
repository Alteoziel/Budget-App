import Papa from "papaparse";
import { z } from "zod";
import { dollarsToCents } from "@/lib/money";

const rowSchema = z.object({
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
};

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

export function parseYnabRegisterCsv(csvText: string): ParseYnabResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });

  const rows: ParsedYnabRow[] = [];
  let skipped = 0;
  const errors: string[] = [...(parsed.errors.map((e) => e.message) ?? [])];

  for (const [index, raw] of (parsed.data ?? []).entries()) {
    const result = rowSchema.safeParse(raw);
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

    const outflow = Math.abs(dollarsToCents(data.Outflow || "0"));
    const inflow = Math.abs(dollarsToCents(data.Inflow || "0"));
    const amountCents = inflow - outflow;
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

  return { rows, skipped, errors: errors.slice(0, 25) };
}

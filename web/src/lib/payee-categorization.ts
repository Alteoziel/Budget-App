import type { SupabaseClient } from "@supabase/supabase-js";

/** Generic / system payees we never learn from or auto-categorize. */
const IGNORED_NORMALIZED_PAYEES = new Set([
  "",
  "bank transaction",
  "balance adjustment",
  "starting balance",
  "opening balance",
  "initial balance",
  "transfer",
  "atm",
  "deposit",
  "withdrawal",
]);

const STOP_TOKENS = new Set([
  "a",
  "an",
  "the",
  "and",
  "of",
  "for",
  "to",
  "in",
  "on",
  "at",
  "by",
  "from",
  "with",
  "inc",
  "llc",
  "ltd",
  "co",
  "corp",
  "company",
  "payment",
  "purchase",
  "debit",
  "credit",
  "card",
  "ach",
  "pos",
  "web",
  "online",
  "recurring",
  "xfer",
  "transfer",
  "check",
  "chk",
  "visa",
  "mastercard",
  "amex",
  "sq",
  "paypal",
  "venmo",
]);

/** Minimum Jaccard similarity for fuzzy payee matches. */
export const PAYEE_SIMILARITY_THRESHOLD = 0.5;
/**
 * If this fraction of a historical payee’s tokens appear in the new one
 * (or vice versa), treat it as the same merchant even when bank text grows.
 */
export const PAYEE_TOKEN_COVERAGE_THRESHOLD = 0.8;
/** Soft floor so short generic tokens alone don't match. */
const MIN_SHARED_TOKEN_CHARS = 6;

export type PayeeCategoryExample = {
  normalizedPayee: string;
  tokens: string[];
  categoryId: string;
  occurredOn: string;
};

export type PayeeCategoryMemory = {
  examples: PayeeCategoryExample[];
  /** Exact normalized payee → most recent category. */
  exact: Map<string, string>;
};

export function normalizePayee(payee: string): string {
  return payee
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function payeeTokens(normalizedPayee: string): string[] {
  if (!normalizedPayee) return [];
  return normalizedPayee
    .split(" ")
    .filter((token) => token.length >= 2 && !STOP_TOKENS.has(token));
}

export function isIgnoredPayee(payee: string): boolean {
  return IGNORED_NORMALIZED_PAYEES.has(normalizePayee(payee));
}

function tokenCharCount(tokens: string[]): number {
  return tokens.reduce((sum, token) => sum + token.length, 0);
}

function sharedTokens(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return [...new Set(a)].filter((token) => setB.has(token));
}

/** Jaccard similarity over token sets (0–1). */
export function payeeTokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) shared += 1;
  }
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Fraction of `part` tokens covered by `whole` (0–1). */
export function payeeTokenCoverage(part: string[], whole: string[]): number {
  if (part.length === 0) return 0;
  const setWhole = new Set(whole);
  let shared = 0;
  for (const token of new Set(part)) {
    if (setWhole.has(token)) shared += 1;
  }
  return shared / new Set(part).size;
}

function containmentScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 8) return 0;
  return longer.includes(shorter) ? 0.85 : 0;
}

/**
 * Score how well a candidate historical payee matches an incoming one.
 * 1 = exact normalized match; lower scores are fuzzy.
 */
export function scorePayeeMatch(
  incomingNormalized: string,
  incomingTokens: string[],
  example: PayeeCategoryExample,
): number {
  if (!incomingNormalized || !example.normalizedPayee) return 0;
  if (incomingNormalized === example.normalizedPayee) return 1;

  const containment = containmentScore(
    incomingNormalized,
    example.normalizedPayee,
  );
  const jaccard = payeeTokenSimilarity(incomingTokens, example.tokens);
  const coverage = Math.max(
    payeeTokenCoverage(example.tokens, incomingTokens),
    payeeTokenCoverage(incomingTokens, example.tokens),
  );
  const sharedChars = tokenCharCount(
    sharedTokens(incomingTokens, example.tokens),
  );

  if (sharedChars < MIN_SHARED_TOKEN_CHARS) return 0;

  if (coverage >= PAYEE_TOKEN_COVERAGE_THRESHOLD) {
    return Math.max(0.9, jaccard, containment, coverage);
  }
  if (jaccard >= PAYEE_SIMILARITY_THRESHOLD) {
    return Math.max(jaccard, containment);
  }
  if (containment >= 0.85) {
    return containment;
  }
  return 0;
}

export function resolveCategoryFromPayeeMemory(
  payee: string,
  memory: PayeeCategoryMemory,
): string | null {
  if (isIgnoredPayee(payee)) return null;
  const normalized = normalizePayee(payee);
  if (!normalized) return null;

  const exact = memory.exact.get(normalized);
  if (exact) return exact;

  const tokens = payeeTokens(normalized);
  if (tokens.length === 0) return null;

  let best: { categoryId: string; score: number; occurredOn: string } | null =
    null;

  for (const example of memory.examples) {
    const score = scorePayeeMatch(normalized, tokens, example);
    if (score <= 0) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && example.occurredOn > best.occurredOn)
    ) {
      best = {
        categoryId: example.categoryId,
        score,
        occurredOn: example.occurredOn,
      };
    }
  }

  return best?.categoryId ?? null;
}

export function buildPayeeCategoryMemory(
  rows: Array<{
    payee: string | null;
    category_id: string | null;
    occurred_on: string | null;
  }>,
): PayeeCategoryMemory {
  const examples: PayeeCategoryExample[] = [];
  const exact = new Map<string, string>();

  for (const row of rows) {
    const categoryId = row.category_id;
    const payee = row.payee ?? "";
    const occurredOn = row.occurred_on ?? "";
    if (!categoryId || !occurredOn || isIgnoredPayee(payee)) continue;

    const normalizedPayee = normalizePayee(payee);
    if (!normalizedPayee) continue;

    if (!exact.has(normalizedPayee)) {
      exact.set(normalizedPayee, categoryId);
    }

    examples.push({
      normalizedPayee,
      tokens: payeeTokens(normalizedPayee),
      categoryId,
      occurredOn,
    });
  }

  return { examples, exact };
}

/**
 * Load recent categorized transactions for a budget and build an in-memory
 * payee → category lookup used during sync / create.
 */
export async function loadPayeeCategoryMemory(
  supabase: SupabaseClient,
  budgetId: string,
  limit = 1000,
): Promise<PayeeCategoryMemory> {
  const { data, error } = await supabase
    .from("transactions")
    .select("payee,category_id,occurred_on")
    .eq("budget_id", budgetId)
    .not("category_id", "is", null)
    .order("occurred_on", { ascending: false })
    .limit(limit);

  if (error) {
    // Best-effort: sync/create should still work without suggestions.
    return { examples: [], exact: new Map() };
  }

  return buildPayeeCategoryMemory(data ?? []);
}

export async function suggestCategoryForPayee(
  supabase: SupabaseClient,
  budgetId: string,
  payee: string,
): Promise<string | null> {
  if (isIgnoredPayee(payee)) return null;
  const memory = await loadPayeeCategoryMemory(supabase, budgetId);
  return resolveCategoryFromPayeeMemory(payee, memory);
}

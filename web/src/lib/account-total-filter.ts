import { cookies } from "next/headers";

/** Cookie fallback when `accounts.include_in_total` is not migrated yet. */
export const EXCLUDE_FROM_TOTAL_COOKIE = "alte_exclude_from_total";

type ExclusionMap = Record<string, string[]>;

export async function readExcludedAccountIds(budgetId: string): Promise<Set<string>> {
  const jar = await cookies();
  const raw = jar.get(EXCLUDE_FROM_TOTAL_COOKIE)?.value;
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as ExclusionMap;
    const list = parsed[budgetId];
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return new Set();
  }
}

export async function writeExcludedAccountIds(
  budgetId: string,
  excludedIds: Set<string>,
): Promise<void> {
  const jar = await cookies();
  let map: ExclusionMap = {};
  const raw = jar.get(EXCLUDE_FROM_TOTAL_COOKIE)?.value;
  if (raw) {
    try {
      map = JSON.parse(raw) as ExclusionMap;
    } catch {
      map = {};
    }
  }
  map[budgetId] = [...excludedIds];
  jar.set(EXCLUDE_FROM_TOTAL_COOKIE, JSON.stringify(map), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

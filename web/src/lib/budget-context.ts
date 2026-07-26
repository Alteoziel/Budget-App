import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { hasRecentPrimarySignIn } from "@/lib/auth/reauth";
import { createClient } from "@/lib/supabase/server";
import type { Budget, BudgetRole } from "@/lib/types";

export const BUDGET_COOKIE = "alte_budget_id";

const ROLE_RANK: Record<BudgetRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

export function roleAtLeast(have: BudgetRole | null | undefined, need: BudgetRole): boolean {
  if (!have) return false;
  return ROLE_RANK[have] >= ROLE_RANK[need];
}

/** Deduped per request — layout + pages share one membership load. */
export const listUserBudgets = cache(async (): Promise<Array<Budget & { role: BudgetRole }>> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: memberships, error } = await supabase
    .from("budget_members")
    .select("role, budget_id")
    .eq("user_id", user.id);
  if (error) {
    throw new Error(
      `Could not load budgets (${error.message}). If this is a new deploy, apply supabase/migrations in order.`,
    );
  }

  const ids = (memberships ?? []).map((m) => m.budget_id as string).filter(Boolean);
  if (!ids.length) return [];

  const { data: budgetRows, error: budgetError } = await supabase
    .from("budgets")
    .select("id, name, created_by")
    .in("id", ids);
  if (budgetError) {
    throw new Error(
      `Could not load budgets (${budgetError.message}). If this is a new deploy, apply supabase/migrations in order.`,
    );
  }

  const byId = new Map((budgetRows ?? []).map((b) => [b.id as string, b as Budget]));

  return (memberships ?? [])
    .map((row) => {
      const b = byId.get(row.budget_id as string);
      if (!b) return null;
      return { ...b, role: row.role as BudgetRole };
    })
    .filter(Boolean) as Array<Budget & { role: BudgetRole }>;
});

/** Deduped per request. */
export const resolveActiveBudget = cache(async (): Promise<{
  budget: Budget;
  role: BudgetRole;
  userId: string;
} | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const cookieStore = await cookies();
  const cookieBudgetId = cookieStore.get(BUDGET_COOKIE)?.value;

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_budget_id")
    .eq("id", user.id)
    .maybeSingle();

  const preferred =
    cookieBudgetId || (profile?.current_budget_id as string | null) || null;

  let budgets: Array<Budget & { role: BudgetRole }>;
  try {
    budgets = await listUserBudgets();
  } catch (err) {
    throw err instanceof Error ? err : new Error("Could not load budgets.");
  }

  if (budgets.length === 0) {
    const created = await supabase
      .from("budgets")
      .insert({ name: "My budget", created_by: user.id })
      .select("id,name,created_by")
      .single();
    if (created.error) {
      throw new Error(
        `Could not create a budget (${created.error.message}). Apply supabase/migrations if tables are missing.`,
      );
    }
    if (created.data?.id) {
      const membership = await supabase.from("budget_members").insert({
        budget_id: created.data.id,
        user_id: user.id,
        role: "owner",
      });
      if (membership.error) {
        throw new Error(
          `Could not join budget (${membership.error.message}). Check budget_members RLS/grants.`,
        );
      }
      await supabase
        .from("profiles")
        .update({ current_budget_id: created.data.id })
        .eq("id", user.id);
      return {
        budget: created.data as Budget,
        role: "owner",
        userId: user.id,
      };
    }
    return null;
  }

  const active =
    budgets.find((b) => b.id === preferred) ??
    budgets.find((b) => b.id === profile?.current_budget_id) ??
    budgets[0]!;

  return { budget: active, role: active.role, userId: user.id };
});

export const requireBudget = cache(async (minRole: BudgetRole = "viewer") => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!hasRecentPrimarySignIn(user.last_sign_in_at)) {
    await supabase.auth.signOut();
    redirect(
      "/login?error=" +
        encodeURIComponent("Your 14-day session expired. Sign in again to continue."),
    );
  }

  const active = await resolveActiveBudget();
  if (!active) redirect("/settings?error=" + encodeURIComponent("No budget available."));
  if (!roleAtLeast(active.role, minRole)) {
    redirect(
      "/budget?error=" +
        encodeURIComponent("You do not have permission for that action."),
    );
  }
  return { supabase, user, ...active };
});

export async function setActiveBudgetId(budgetId: string) {
  const cookieStore = await cookies();
  cookieStore.set(BUDGET_COOKIE, budgetId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}

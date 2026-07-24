import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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

export async function listUserBudgets(): Promise<
  Array<Budget & { role: BudgetRole }>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("budget_members")
    .select("role, budgets(id, name, created_by)")
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => {
      const budget = row.budgets as unknown as Budget | Budget[] | null;
      const b = Array.isArray(budget) ? budget[0] : budget;
      if (!b) return null;
      return { ...b, role: row.role as BudgetRole };
    })
    .filter(Boolean) as Array<Budget & { role: BudgetRole }>;
}

export async function resolveActiveBudget(): Promise<{
  budget: Budget;
  role: BudgetRole;
  userId: string;
} | null> {
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

  const budgets = await listUserBudgets();
  if (budgets.length === 0) {
    // Bootstrap a budget if trigger somehow missed (legacy users).
    const created = await supabase
      .from("budgets")
      .insert({ name: "My budget", created_by: user.id })
      .select("id,name,created_by")
      .single();
    if (created.data?.id) {
      await supabase.from("budget_members").insert({
        budget_id: created.data.id,
        user_id: user.id,
        role: "owner",
      });
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
}

export async function requireBudget(minRole: BudgetRole = "viewer") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await resolveActiveBudget();
  if (!active) redirect("/settings?error=" + encodeURIComponent("No budget available."));
  if (!roleAtLeast(active.role, minRole)) {
    redirect(
      "/budget?error=" +
        encodeURIComponent("You do not have permission for that action."),
    );
  }
  return { supabase, user, ...active };
}

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

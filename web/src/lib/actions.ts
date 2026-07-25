"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  currentBudgetMonth,
  dollarsToCents,
  isBudgetMonth,
  isValidIsoDate,
} from "@/lib/money";
import { distributeByPercent } from "@/lib/auto-assign";
import { getBudgetRows } from "@/lib/budget-data";
import { requireBudget, setActiveBudgetId } from "@/lib/budget-context";
import {
  clearPasswordResetGrant,
  hasPasswordResetGrant,
} from "@/lib/password-reset";
import { safeInternalPath } from "@/lib/paths";
import { absoluteUrl, siteOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import type { BudgetRole } from "@/lib/types";
import {
  parseYnabCsv,
  ynabRowFingerprint,
  type ParsedYnabRow,
} from "@/lib/ynab-csv";
import {
  readExcludedAccountIds,
  writeExcludedAccountIds,
} from "@/lib/account-total-filter";
import { READY_TO_ASSIGN_TARGET_ID } from "@/lib/overspend-fix";
import {
  balanceAnchorExternalId,
  isBalanceAnchorExternalId,
  suggestMatchForManualTransaction,
} from "@/lib/transaction-matching";

const ACCOUNT_TYPES = new Set([
  "checking",
  "savings",
  "credit",
  "cash",
  "other",
]);

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

function redirectWithError(path: string, message: string, extra = ""): never {
  const url = `${path}?error=${encodeURIComponent(message)}${extra}`;
  redirect(url);
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "23505" || /duplicate|unique/i.test(error?.message ?? "");
}

function escapeIlikeExact(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeInternalPath(String(formData.get("next") ?? "/budget"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirectWithError("/login", error.message);
  }
  redirect(next);
}

export async function signUpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const next = safeInternalPath(String(formData.get("next") ?? "/budget"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName || email.split("@")[0] },
    },
  });
  if (error) {
    redirectWithError("/login", error.message, "&mode=signup");
  }
  redirect(next);
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function updateDisplayNameAction(
  formData: FormData,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { supabase, user } = await requireUser();
  const displayName = String(formData.get("display_name") ?? "").trim();
  if (!displayName) return { ok: false, error: "Display name is required." };
  if (displayName.length > 80) return { ok: false, error: "Name must be 80 characters or fewer." };

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Could not update display name." };

  await supabase.auth.updateUser({ data: { display_name: displayName } });
  revalidatePath("/settings");
  return { ok: true, message: "Display name saved." };
}

/** Email a password-reset confirmation link to the signed-in user. */
export async function requestPasswordResetAction(): Promise<
  { ok: true; message: string } | { ok: false; error: string }
> {
  const { supabase, user } = await requireUser();
  if (!user.email) {
    return { ok: false, error: "Your account has no email address on file." };
  }
  if (!siteOrigin()) {
    return {
      ok: false,
      error: "Site URL is not configured, so we can’t email a confirmation link.",
    };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: absoluteUrl("/auth/callback?next=/settings/password"),
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    message: "Check your email for a confirmation link. It expires soon.",
  };
}

/**
 * Set a new password — only after the user confirmed a recovery email link
 * (short-lived grant cookie from /auth/callback).
 */
export async function updatePasswordAction(
  formData: FormData,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  await requireUser();
  if (!(await hasPasswordResetGrant())) {
    return {
      ok: false,
      error:
        "Confirm the link we emailed you before changing your password.",
    };
  }

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("password_confirm") ?? "");
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { ok: false, error: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, error: error.message };

  await clearPasswordResetGrant();
  revalidatePath("/settings");
  revalidatePath("/settings/password");
  return { ok: true, message: "Password updated." };
}

export async function createAccountAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const name = String(formData.get("name") ?? "").trim();
  const accountType = String(formData.get("account_type") ?? "checking");
  if (!name) {
    redirectWithError("/accounts", "Account name is required.");
  }
  if (!ACCOUNT_TYPES.has(accountType)) {
    redirectWithError("/accounts", "Invalid account type.");
  }

  let sortOrder = 0;
  const maxSort = await supabase
    .from("accounts")
    .select("sort_order")
    .eq("budget_id", budget.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!maxSort.error) {
    sortOrder = Number(maxSort.data?.sort_order ?? -1) + 1;
  }

  let { error } = await supabase.from("accounts").insert({
    user_id: user.id,
    budget_id: budget.id,
    name,
    account_type: accountType,
    include_in_total: true,
    sort_order: sortOrder,
  });
  if (
    error &&
    /include_in_total|sort_order|schema cache|column/i.test(error.message)
  ) {
    ({ error } = await supabase.from("accounts").insert({
      user_id: user.id,
      budget_id: budget.id,
      name,
      account_type: accountType,
      include_in_total: true,
    }));
  }
  if (error && /include_in_total|schema cache|column/i.test(error.message)) {
    ({ error } = await supabase.from("accounts").insert({
      user_id: user.id,
      budget_id: budget.id,
      name,
      account_type: accountType,
    }));
  }
  if (error) {
    redirectWithError(
      "/accounts",
      isUniqueViolation(error)
        ? "An account with that name already exists."
        : "Could not create account.",
    );
  }
  revalidatePath("/accounts");
  revalidatePath("/budget");
}

/**
 * Persist a full account order for the active budget.
 * Prefer the reorder_budget_accounts RPC; fall back to direct updates.
 */
export async function reorderAccountsAction(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, budget } = await requireBudget("editor");
  const ids = orderedIds.map((id) => String(id ?? "").trim()).filter(Boolean);
  if (ids.length < 2) {
    return { ok: false, error: "Need at least two accounts to reorder." };
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "Invalid account order." };
  }

  const rpc = await supabase.rpc("reorder_budget_accounts", {
    p_budget_id: budget.id,
    p_account_ids: ids,
  });

  if (!rpc.error) {
    revalidatePath("/accounts");
    return { ok: true };
  }

  const missingRpc = /could not find the function|schema cache|does not exist/i.test(
    rpc.error.message,
  );
  if (!missingRpc) {
    return {
      ok: false,
      error: rpc.error.message.slice(0, 160) || "Could not update account order.",
    };
  }

  // Fallback without RPC: write sort_order directly (needs column + UPDATE RLS).
  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .eq("budget_id", budget.id);
  if (error) {
    return {
      ok: false,
      error: /sort_order|schema cache|column/i.test(error.message)
        ? "Run supabase/migrations/20260725030000_reorder_budget_accounts_rpc.sql in Supabase."
        : "Could not load accounts.",
    };
  }

  const owned = new Set((data ?? []).map((row) => String(row.id)));
  if (owned.size !== ids.length || ids.some((id) => !owned.has(id))) {
    return { ok: false, error: "Account list mismatch." };
  }

  for (let i = 0; i < ids.length; i += 1) {
    const { data: updated, error: updateError } = await supabase
      .from("accounts")
      .update({ sort_order: i })
      .eq("budget_id", budget.id)
      .eq("id", ids[i])
      .select("id,sort_order")
      .maybeSingle();
    if (updateError) {
      return {
        ok: false,
        error: /sort_order|schema cache|column/i.test(updateError.message)
          ? "Run supabase/migrations/20260725030000_reorder_budget_accounts_rpc.sql in Supabase."
          : "Could not update account order.",
      };
    }
    if (!updated || Number(updated.sort_order) !== i) {
      return {
        ok: false,
        error:
          "Could not save account order. Run supabase/migrations/20260725030000_reorder_budget_accounts_rpc.sql in Supabase.",
      };
    }
  }

  revalidatePath("/accounts");
  return { ok: true };
}

export async function setAccountIncludeInTotalAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("editor");
  const accountId = String(formData.get("account_id") ?? "").trim();
  const includeRaw = String(formData.get("include_in_total") ?? "").trim();
  const includeInTotal = includeRaw === "true" || includeRaw === "1" || includeRaw === "on";

  if (!accountId) {
    redirectWithError("/accounts", "Account not found.");
  }

  const { data: account, error: lookupError } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .eq("budget_id", budget.id)
    .maybeSingle();

  if (lookupError || !account) {
    redirectWithError("/accounts", "Account not found.");
  }

  const { data: updated, error } = await supabase
    .from("accounts")
    .update({ include_in_total: includeInTotal })
    .eq("id", accountId)
    .eq("budget_id", budget.id)
    .select("id")
    .maybeSingle();

  if (error) {
    // Column missing / schema cache — fall back to an httpOnly cookie until migration runs.
    if (/include_in_total|schema cache|column/i.test(error.message)) {
      const excluded = await readExcludedAccountIds(budget.id);
      if (includeInTotal) excluded.delete(accountId);
      else excluded.add(accountId);
      await writeExcludedAccountIds(budget.id, excluded);
      revalidatePath("/accounts");
      return;
    }
    redirectWithError(
      "/accounts",
      `Could not update account filter: ${error.message.slice(0, 160)}`,
    );
  }

  if (!updated?.id) {
    redirectWithError(
      "/accounts",
      "Could not update account filter. Check you have editor access.",
    );
  }

  revalidatePath("/accounts");
}

export async function deleteAccountAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("editor");
  const accountId = String(formData.get("account_id") ?? "").trim();
  if (!accountId) {
    redirectWithError("/accounts", "Account not found.");
  }

  const { data: account, error: lookupError } = await supabase
    .from("accounts")
    .select("id,name")
    .eq("id", accountId)
    .eq("budget_id", budget.id)
    .maybeSingle();

  if (lookupError || !account) {
    redirectWithError("/accounts", "Account not found.");
  }

  // Clear bank mapping first (also cascades from account delete; explicit for clarity).
  await supabase
    .from("plaid_accounts")
    .delete()
    .eq("account_id", accountId)
    .eq("budget_id", budget.id);

  const { error } = await supabase
    .from("accounts")
    .delete()
    .eq("id", accountId)
    .eq("budget_id", budget.id);

  if (error) {
    redirectWithError(
      "/accounts",
      `Could not delete “${account!.name}”. Remove linked bank mapping or try again.`,
    );
  }

  revalidatePath("/accounts");
  revalidatePath("/budget");
  revalidatePath("/insights");
  revalidatePath("/settings");
  redirect("/accounts");
}

async function nextGroupSortOrder(
  supabase: Awaited<ReturnType<typeof requireBudget>>["supabase"],
  budgetId: string,
): Promise<number> {
  const { data } = await supabase
    .from("category_groups")
    .select("sort_order")
    .eq("budget_id", budgetId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number(data?.sort_order ?? -1) + 1;
}

async function nextCategorySortOrder(
  supabase: Awaited<ReturnType<typeof requireBudget>>["supabase"],
  budgetId: string,
  groupId: string,
): Promise<number> {
  const { data } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("budget_id", budgetId)
    .eq("group_id", groupId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number(data?.sort_order ?? -1) + 1;
}

async function resolveCategoryGroupId(
  supabase: Awaited<ReturnType<typeof requireBudget>>["supabase"],
  userId: string,
  budgetId: string,
  groupName: string,
): Promise<string | null> {
  const existing = await supabase
    .from("category_groups")
    .select("id")
    .eq("budget_id", budgetId)
    .ilike("name", escapeIlikeExact(groupName))
    .maybeSingle();
  if (existing.data?.id) return existing.data.id as string;

  const sortOrder = await nextGroupSortOrder(supabase, budgetId);
  const created = await supabase
    .from("category_groups")
    .insert({
      user_id: userId,
      budget_id: budgetId,
      name: groupName,
      sort_order: sortOrder,
    })
    .select("id")
    .single();
  if (created.data?.id) return created.data.id as string;

  const again = await supabase
    .from("category_groups")
    .select("id")
    .eq("budget_id", budgetId)
    .ilike("name", escapeIlikeExact(groupName))
    .maybeSingle();
  return (again.data?.id as string | undefined) ?? null;
}

type SortableRow = { id: string; sort_order: number; name: string };

function compareSortable(a: SortableRow, b: SortableRow) {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

async function swapSortOrder(options: {
  supabase: Awaited<ReturnType<typeof requireBudget>>["supabase"];
  table: "category_groups" | "categories" | "accounts";
  budgetId: string;
  rows: SortableRow[];
  targetId: string;
  direction: "up" | "down";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ordered = [...options.rows].sort(compareSortable);
  // Normalize so all-zero / tied rows become stable 0..n-1 before swapping.
  for (let i = 0; i < ordered.length; i += 1) {
    if (ordered[i].sort_order !== i) {
      const { error } = await options.supabase
        .from(options.table)
        .update({ sort_order: i })
        .eq("budget_id", options.budgetId)
        .eq("id", ordered[i].id);
      if (error) return { ok: false, error: "Could not update order." };
      ordered[i] = { ...ordered[i], sort_order: i };
    }
  }

  const index = ordered.findIndex((row) => row.id === options.targetId);
  if (index < 0) return { ok: false, error: "Item not found." };
  const swapWith = options.direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= ordered.length) {
    return { ok: false, error: "Already at the end." };
  }

  const a = ordered[index];
  const b = ordered[swapWith];
  const updates = [
    { id: a.id, sort_order: b.sort_order },
    { id: b.id, sort_order: a.sort_order },
  ];
  for (const update of updates) {
    const { error } = await options.supabase
      .from(options.table)
      .update({ sort_order: update.sort_order })
      .eq("budget_id", options.budgetId)
      .eq("id", update.id);
    if (error) return { ok: false, error: "Could not update order." };
  }
  return { ok: true };
}

export async function createCategoryGroupAction(
  name: string,
): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const { supabase, user, budget } = await requireBudget("editor");
  const groupName = name.trim();
  if (!groupName) return { ok: false, error: "Group name is required." };
  if (groupName.length > 80) return { ok: false, error: "Group name is too long." };

  const groupId = await resolveCategoryGroupId(
    supabase,
    user.id,
    budget.id,
    groupName,
  );
  if (!groupId) return { ok: false, error: "Could not create category group." };

  revalidatePath("/budget");
  return { ok: true, id: groupId, name: groupName };
}

export async function createCategoryAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const selectedGroupId = String(formData.get("group_id") ?? "").trim();
  const groupName = String(formData.get("group_name") ?? "").trim() || "Everyday";
  const categoryName = String(formData.get("category_name") ?? "").trim();
  if (!categoryName) {
    redirectWithError("/budget", "Category name is required.");
  }

  let groupId: string | null = null;
  if (selectedGroupId) {
    const owned = await supabase
      .from("category_groups")
      .select("id")
      .eq("budget_id", budget.id)
      .eq("id", selectedGroupId)
      .maybeSingle();
    groupId = (owned.data?.id as string | undefined) ?? null;
    if (!groupId) {
      redirectWithError("/budget", "Category group not found.");
    }
  } else {
    groupId = await resolveCategoryGroupId(supabase, user.id, budget.id, groupName);
  }

  if (!groupId) {
    redirectWithError("/budget", "Could not create category group.");
  }

  const sortOrder = await nextCategorySortOrder(supabase, budget.id, groupId);
  const { error } = await supabase.from("categories").insert({
    user_id: user.id,
    budget_id: budget.id,
    group_id: groupId,
    name: categoryName,
    sort_order: sortOrder,
  });
  if (error) {
    redirectWithError(
      "/budget",
      isUniqueViolation(error)
        ? "That category already exists in this group."
        : "Could not create category.",
    );
  }

  revalidatePath("/budget");
}

export async function setCategoryGoalAction(
  input: {
    categoryId: string;
    amount: string;
    goalName: string;
    frequency: string;
    note: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, budget } = await requireBudget("editor");
  const categoryId = input.categoryId.trim();
  if (!categoryId) return { ok: false, error: "Category not found." };

  const frequencies = new Set(["weekly", "monthly", "quarterly", "yearly", "once"]);
  const frequency = frequencies.has(input.frequency) ? input.frequency : "monthly";

  const rawAmount = input.amount.trim();
  let goalCents: number | null = null;
  if (rawAmount) {
    const parsed = dollarsToCents(rawAmount);
    if (parsed == null || parsed < 0) {
      return { ok: false, error: "Enter a goal amount like 250.00, or leave it blank." };
    }
    goalCents = parsed;
  }

  const owned = await supabase
    .from("categories")
    .select("id")
    .eq("budget_id", budget.id)
    .eq("id", categoryId)
    .maybeSingle();
  if (!owned.data?.id) return { ok: false, error: "Category not found." };

  const { error } = await supabase
    .from("categories")
    .update({
      goal_cents: goalCents,
      goal_name: input.goalName.trim().slice(0, 120),
      goal_frequency: frequency,
      goal_note: input.note.trim().slice(0, 500),
    })
    .eq("budget_id", budget.id)
    .eq("id", categoryId);

  if (error) {
    return {
      ok: false,
      error: /goal_|column|schema cache/i.test(error.message)
        ? "Run the category goals migration in Supabase, then try again."
        : "Could not save this goal.",
    };
  }

  revalidatePath("/budget");
  return { ok: true };
}

export async function clearCategoryGoalAction(
  categoryId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return setCategoryGoalAction({
    categoryId,
    amount: "",
    goalName: "",
    frequency: "monthly",
    note: "",
  });
}

export async function renameCategoryAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const categoryId = String(formData.get("category_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!categoryId || !name) {
    redirectWithError("/budget", "Category name is required.");
  }

  const { error } = await supabase
    .from("categories")
    .update({ name })
    .eq("budget_id", budget.id)
    .eq("id", categoryId);
  if (error) {
    redirectWithError(
      "/budget",
      isUniqueViolation(error)
        ? "A category with that name already exists in this group."
        : "Could not rename category.",
    );
  }

  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export async function deleteCategoryAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const categoryId = String(formData.get("category_id") ?? "");
  if (!categoryId) {
    redirectWithError("/budget", "Category not found.");
  }

  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("budget_id", budget.id)
    .eq("id", categoryId);
  if (error) {
    redirectWithError("/budget", "Could not delete category.");
  }

  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export async function renameCategoryGroupAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const groupId = String(formData.get("group_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!groupId || !name) {
    redirectWithError("/budget", "Group name is required.");
  }

  const { error } = await supabase
    .from("category_groups")
    .update({ name })
    .eq("budget_id", budget.id)
    .eq("id", groupId);
  if (error) {
    redirectWithError(
      "/budget",
      isUniqueViolation(error)
        ? "A group with that name already exists."
        : "Could not rename group.",
    );
  }

  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export async function deleteCategoryGroupAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("editor");
  const groupId = String(formData.get("group_id") ?? "");
  if (!groupId) {
    redirectWithError("/budget", "Group not found.");
  }

  // Cascades to categories; transactions.category_id becomes null via FK.
  const { error } = await supabase
    .from("category_groups")
    .delete()
    .eq("budget_id", budget.id)
    .eq("id", groupId);
  if (error) {
    redirectWithError("/budget", "Could not delete group.");
  }

  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export async function reorderCategoryGroupAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("editor");
  const groupId = String(formData.get("group_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!groupId || (direction !== "up" && direction !== "down")) {
    redirectWithError("/budget", "Invalid reorder.");
  }

  const { data, error } = await supabase
    .from("category_groups")
    .select("id,name,sort_order,hidden")
    .eq("budget_id", budget.id);
  if (error) {
    redirectWithError("/budget", "Could not load groups.");
  }

  const rows = ((data ?? []) as Array<{
    id: string;
    name: string;
    sort_order: number;
    hidden: boolean;
  }>)
    .filter((row) => !row.hidden)
    .map((row) => ({
      id: row.id,
      name: row.name,
      sort_order: Number(row.sort_order ?? 0),
    }));

  const result = await swapSortOrder({
    supabase,
    table: "category_groups",
    budgetId: budget.id,
    rows,
    targetId: groupId,
    direction,
  });
  if (!result.ok) {
    redirectWithError("/budget", result.error);
  }

  revalidatePath("/budget");
}

export async function reorderCategoryAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("editor");
  const categoryId = String(formData.get("category_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!categoryId || (direction !== "up" && direction !== "down")) {
    redirectWithError("/budget", "Invalid reorder.");
  }

  const owned = await supabase
    .from("categories")
    .select("id,group_id")
    .eq("budget_id", budget.id)
    .eq("id", categoryId)
    .maybeSingle();
  if (!owned.data?.id) {
    redirectWithError("/budget", "Category not found.");
  }

  const { data, error } = await supabase
    .from("categories")
    .select("id,name,sort_order,hidden")
    .eq("budget_id", budget.id)
    .eq("group_id", owned.data.group_id as string);
  if (error) {
    redirectWithError("/budget", "Could not load categories.");
  }

  const rows = ((data ?? []) as Array<{
    id: string;
    name: string;
    sort_order: number;
    hidden: boolean;
  }>)
    .filter((row) => !row.hidden)
    .map((row) => ({
      id: row.id,
      name: row.name,
      sort_order: Number(row.sort_order ?? 0),
    }));

  const result = await swapSortOrder({
    supabase,
    table: "categories",
    budgetId: budget.id,
    rows,
    targetId: categoryId,
    direction,
  });
  if (!result.ok) {
    redirectWithError("/budget", result.error);
  }

  revalidatePath("/budget");
}

async function upsertAssignedCents(options: {
  supabase: Awaited<ReturnType<typeof requireBudget>>["supabase"];
  userId: string;
  budgetId: string;
  categoryId: string;
  month: string;
  assignedCents: number;
}) {
  const monthUpsert = await options.supabase.from("budget_months").upsert(
    { user_id: options.userId, budget_id: options.budgetId, month: options.month },
    { onConflict: "budget_id,month" },
  );
  if (monthUpsert.error) {
    redirectWithError("/budget", "Could not save budget month.");
  }

  const { error } = await options.supabase.from("category_months").upsert(
    {
      user_id: options.userId,
      budget_id: options.budgetId,
      category_id: options.categoryId,
      month: options.month,
      assigned_cents: options.assignedCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "budget_id,category_id,month" },
  );
  if (error) {
    redirectWithError("/budget", "Could not save assignment.");
  }
}

/** One amount box: +, −, set, auto:%, auto:# */
export async function categoryAmountAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const categoryId = String(formData.get("category_id") ?? "");
  const month = String(formData.get("month") ?? currentBudgetMonth());
  const intent = String(formData.get("intent") ?? "");
  const amountRaw = String(formData.get("amount") ?? "").trim();

  if (!categoryId || !isBudgetMonth(month)) {
    redirectWithError("/budget", "Invalid assignment.");
  }

  const owned = await supabase
    .from("categories")
    .select("id")
    .eq("budget_id", budget.id)
    .eq("id", categoryId)
    .maybeSingle();
  if (!owned.data?.id) {
    redirectWithError("/budget", "Category not found.");
  }

  if (intent === "auto_percent") {
    const percent = Number(amountRaw);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      redirectWithError("/budget", "Enter a percentage between 0 and 100.");
    }
    const { error } = await supabase
      .from("categories")
      .update({
        assign_mode: "percent",
        assign_percent: Math.round(percent * 100) / 100,
      })
      .eq("budget_id", budget.id)
      .eq("id", categoryId);
    if (error) {
      redirectWithError(
        "/budget",
        /assign_mode|assign_percent|column|schema cache/i.test(error.message)
          ? "Run the assign_fixed_cents migration in Supabase, then try again."
          : "Could not save auto:% rule.",
      );
    }
    revalidatePath("/budget");
    return;
  }

  if (intent === "auto_fixed") {
    const cents = dollarsToCents(amountRaw || "0");
    if (cents === null || cents < 0) {
      redirectWithError("/budget", "Enter a valid dollar amount for auto:#.");
    }
    const { error } = await supabase
      .from("categories")
      .update({
        assign_mode: "fixed",
        assign_fixed_cents: cents,
      })
      .eq("budget_id", budget.id)
      .eq("id", categoryId);
    if (error) {
      redirectWithError(
        "/budget",
        /assign_mode|assign_fixed|column|schema cache/i.test(error.message)
          ? "Run the assign_fixed_cents migration in Supabase, then try again."
          : "Could not save auto:# rule.",
      );
    }
    revalidatePath("/budget");
    return;
  }

  const delta = dollarsToCents(amountRaw || "0");
  if (delta === null) {
    redirectWithError("/budget", "Enter a valid dollar amount.");
  }

  const currentRes = await supabase
    .from("category_months")
    .select("assigned_cents")
    .eq("budget_id", budget.id)
    .eq("category_id", categoryId)
    .eq("month", month)
    .maybeSingle();
  if (currentRes.error) {
    redirectWithError("/budget", "Could not load current assignment.");
  }
  const current = Number(currentRes.data?.assigned_cents ?? 0);

  let next = current;
  if (intent === "add") next = current + delta;
  else if (intent === "sub") next = current - delta;
  else if (intent === "set") next = delta;
  else redirectWithError("/budget", "Unknown amount action.");

  await upsertAssignedCents({
    supabase,
    userId: user.id,
    budgetId: budget.id,
    categoryId,
    month,
    assignedCents: next,
  });
  revalidatePath("/budget");
}

/** @deprecated Prefer categoryAmountAction with intent=set */
export async function assignCategoryAction(formData: FormData) {
  if (!formData.get("intent")) formData.set("intent", "set");
  if (!formData.get("amount") && formData.get("assigned") != null) {
    formData.set("amount", String(formData.get("assigned")));
  }
  return categoryAmountAction(formData);
}

/** @deprecated Prefer categoryAmountAction with intent=auto_percent */
export async function setCategoryAssignPercentAction(formData: FormData) {
  if (!formData.get("intent")) formData.set("intent", "auto_percent");
  if (!formData.get("amount") && formData.get("assign_percent") != null) {
    formData.set("amount", String(formData.get("assign_percent")));
  }
  return categoryAmountAction(formData);
}

export async function autoAssignAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const month = String(formData.get("month") ?? currentBudgetMonth());
  if (!isBudgetMonth(month)) {
    redirectWithError("/budget", "Invalid month.");
  }

  const { readyToAssignCents, rows } = await getBudgetRows(month);
  if (readyToAssignCents <= 0) {
    redirectWithError(
      "/budget",
      "Ready to assign is not positive. Use Fix Now to cover the shortfall first.",
    );
  }
  const { assignments, totalAdded, error: distError } = distributeByPercent(
    readyToAssignCents,
    rows.map((row) => ({
      categoryId: row.categoryId,
      assignMode: row.assignMode,
      assignPercent: row.assignPercent,
      assignFixedCents: row.assignFixedCents,
      currentAssignedCents: row.assignedCents,
    })),
  );
  if (distError) {
    redirectWithError("/budget", distError);
  }
  if (totalAdded <= 0) {
    redirectWithError("/budget", "Nothing to auto-assign.");
  }

  const monthUpsert = await supabase.from("budget_months").upsert(
    { user_id: user.id, budget_id: budget.id, month },
    { onConflict: "budget_id,month" },
  );
  if (monthUpsert.error) {
    redirectWithError("/budget", "Could not save budget month.");
  }

  for (const assignment of assignments) {
    if (assignment.addedCents <= 0) continue;
    const { error } = await supabase.from("category_months").upsert(
      {
        user_id: user.id,
        budget_id: budget.id,
        category_id: assignment.categoryId,
        month,
        assigned_cents: assignment.assignedCents,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "budget_id,category_id,month" },
    );
    if (error) {
      redirectWithError("/budget", "Auto-assign failed partway — try again.");
    }
  }

  revalidatePath("/budget");
  redirect(`/budget?assigned=${totalAdded}`);
}

const MONEY_EXCHANGES_ACCOUNT = "Money Exchanges";

async function ensureMoneyExchangesAccount(
  supabase: Awaited<ReturnType<typeof requireBudget>>["supabase"],
  userId: string,
  budgetId: string,
): Promise<string | null> {
  const existing = await supabase
    .from("accounts")
    .select("id")
    .eq("budget_id", budgetId)
    .ilike("name", escapeIlikeExact(MONEY_EXCHANGES_ACCOUNT))
    .maybeSingle();
  if (existing.data?.id) return existing.data.id as string;

  const created = await supabase
    .from("accounts")
    .insert({
      user_id: userId,
      budget_id: budgetId,
      name: MONEY_EXCHANGES_ACCOUNT,
      account_type: "other",
    })
    .select("id")
    .single();
  if (created.data?.id) return created.data.id as string;

  // Lost a race, or the column set differs — look it up once more.
  const retry = await supabase
    .from("accounts")
    .select("id")
    .eq("budget_id", budgetId)
    .ilike("name", escapeIlikeExact(MONEY_EXCHANGES_ACCOUNT))
    .maybeSingle();
  return (retry.data?.id as string | undefined) ?? null;
}

export async function applyOverspendFixAction(payload: {
  month: string;
  donations: Array<{ categoryId: string; cents: number }>;
  allocations: Array<{ fromCategoryId: string; toCategoryId: string; cents: number }>;
}): Promise<{ ok: true; movedCents: number } | { ok: false; error: string }> {
  const { supabase, user, budget } = await requireBudget("editor");
  const month = isBudgetMonth(payload.month) ? payload.month : currentBudgetMonth();

  const donations = (payload.donations ?? []).filter((d) => d.cents > 0);
  const allocations = (payload.allocations ?? []).filter((a) => a.cents > 0);
  if (!donations.length || !allocations.length) {
    return { ok: false, error: "Nothing to move yet." };
  }

  const { rows } = await getBudgetRows(month);
  const rowById = new Map(rows.map((row) => [row.categoryId, row]));

  // A donor can never give away more than it actually has available.
  for (const donation of donations) {
    const row = rowById.get(donation.categoryId);
    if (!row) return { ok: false, error: "A category in this fix no longer exists." };
    if (donation.cents > row.availableCents) {
      return {
        ok: false,
        error: `${row.categoryName} only has ${(row.availableCents / 100).toFixed(2)} available.`,
      };
    }
  }

  const donatedTotal = donations.reduce((sum, d) => sum + d.cents, 0);
  const allocatedTotal = allocations.reduce((sum, a) => sum + a.cents, 0);
  if (allocatedTotal > donatedTotal) {
    return { ok: false, error: "Allocations exceed the money pulled from categories." };
  }

  const toReadyToAssign = allocations.filter(
    (a) => a.toCategoryId === READY_TO_ASSIGN_TARGET_ID,
  );
  const betweenCategories = allocations.filter(
    (a) => a.toCategoryId !== READY_TO_ASSIGN_TARGET_ID,
  );

  for (const allocation of betweenCategories) {
    if (!rowById.has(allocation.toCategoryId)) {
      return { ok: false, error: "An overspent category no longer exists." };
    }
  }

  const monthUpsert = await supabase.from("budget_months").upsert(
    { user_id: user.id, budget_id: budget.id, month },
    { onConflict: "budget_id,month" },
  );
  if (monthUpsert.error) {
    return { ok: false, error: "Could not save budget month." };
  }

  // Money returned to Ready to assign lowers what the donor has assigned.
  const pulledBack = new Map<string, number>();
  for (const allocation of toReadyToAssign) {
    pulledBack.set(
      allocation.fromCategoryId,
      (pulledBack.get(allocation.fromCategoryId) ?? 0) + allocation.cents,
    );
  }
  for (const [categoryId, cents] of pulledBack) {
    const row = rowById.get(categoryId);
    if (!row) continue;
    const { error } = await supabase.from("category_months").upsert(
      {
        user_id: user.id,
        budget_id: budget.id,
        category_id: categoryId,
        month,
        assigned_cents: row.assignedCents - cents,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "budget_id,category_id,month" },
    );
    if (error) {
      return { ok: false, error: "Could not return money to Ready to assign." };
    }
  }

  // Category-to-category coverage is recorded as a matched pair of transactions.
  let movedCents = toReadyToAssign.reduce((sum, a) => sum + a.cents, 0);
  if (betweenCategories.length) {
    const accountId = await ensureMoneyExchangesAccount(supabase, user.id, budget.id);
    if (!accountId) {
      return { ok: false, error: `Could not create the “${MONEY_EXCHANGES_ACCOUNT}” account.` };
    }

    const today = new Date().toISOString().slice(0, 10);
    const txnRows = betweenCategories.flatMap((allocation) => {
      const from = rowById.get(allocation.fromCategoryId);
      const to = rowById.get(allocation.toCategoryId);
      const fromName = from?.categoryName ?? "Category";
      const toName = to?.categoryName ?? "Category";
      const memo = `Budget fix ${month}`;
      return [
        {
          user_id: user.id,
          budget_id: budget.id,
          account_id: accountId,
          category_id: allocation.fromCategoryId,
          occurred_on: today,
          payee: `${fromName} → ${toName}`.slice(0, 200),
          memo,
          amount_cents: -allocation.cents,
          cleared: true,
        },
        {
          user_id: user.id,
          budget_id: budget.id,
          account_id: accountId,
          category_id: allocation.toCategoryId,
          occurred_on: today,
          payee: `${toName} ← ${fromName}`.slice(0, 200),
          memo,
          amount_cents: allocation.cents,
          cleared: true,
        },
      ];
    });

    const { error } = await supabase.from("transactions").insert(txnRows);
    if (error) {
      return { ok: false, error: "Could not record the money exchange transactions." };
    }
    movedCents += betweenCategories.reduce((sum, a) => sum + a.cents, 0);
  }

  revalidatePath("/budget");
  revalidatePath("/accounts");
  revalidatePath("/insights");
  return { ok: true, movedCents };
}

export async function createTransactionAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const accountId = String(formData.get("account_id") ?? "");
  const payee = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();
  const occurredOn = String(formData.get("occurred_on") ?? "");
  const categoryIdRaw = String(formData.get("category_id") ?? "");
  const amount = dollarsToCents(String(formData.get("amount") ?? ""));
  const direction = String(formData.get("direction") ?? "outflow");

  if (!accountId) {
    redirect("/accounts");
  }
  if (amount === null || amount === 0) {
    redirectWithError(`/accounts/${accountId}`, "Enter a valid non-zero amount.");
  }
  const amountValue = amount as number;
  if (!isValidIsoDate(occurredOn)) {
    redirectWithError(`/accounts/${accountId}`, "Invalid date.");
  }
  if (direction !== "inflow" && direction !== "outflow") {
    redirectWithError(`/accounts/${accountId}`, "Invalid direction.");
  }

  const account = await supabase
    .from("accounts")
    .select("id")
    .eq("budget_id", budget.id)
    .eq("id", accountId)
    .maybeSingle();
  if (!account.data?.id) {
    redirect("/accounts");
  }

  const categoryId: string | null = categoryIdRaw || null;
  if (categoryId) {
    const category = await supabase
      .from("categories")
      .select("id")
      .eq("budget_id", budget.id)
      .eq("id", categoryId)
      .maybeSingle();
    if (!category.data?.id) {
      redirectWithError(`/accounts/${accountId}`, "Category not found.");
    }
  }

  const amountCents =
    direction === "inflow" ? Math.abs(amountValue) : -Math.abs(amountValue);

  const { data: created, error } = await supabase
    .from("transactions")
    .insert({
      user_id: user.id,
      budget_id: budget.id,
      account_id: accountId,
      category_id: categoryId,
      occurred_on: occurredOn,
      payee,
      memo,
      amount_cents: amountCents,
      cleared: true,
    })
    .select("id")
    .single();
  if (error || !created?.id) {
    redirectWithError(`/accounts/${accountId}`, "Could not save transaction.");
  }

  try {
    await suggestMatchForManualTransaction(supabase, {
      budgetId: budget.id,
      accountId,
      manualTransactionId: created.id,
      amountCents,
      occurredOn,
    });
  } catch {
    // Matching is best-effort.
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/budget");
  redirect(
    `/accounts/${accountId}?notice=${encodeURIComponent("Transaction Saved")}`,
  );
}

export async function setAccountBalanceAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const accountId = String(formData.get("account_id") ?? "").trim();
  const balance = dollarsToCents(String(formData.get("balance") ?? ""));

  if (!accountId) {
    redirect("/accounts");
  }
  if (balance === null) {
    redirectWithError(`/accounts/${accountId}`, "Enter a valid account balance.");
  }

  const account = await supabase
    .from("accounts")
    .select("id")
    .eq("budget_id", budget.id)
    .eq("id", accountId)
    .maybeSingle();
  if (!account.data?.id) {
    redirect("/accounts");
  }

  const externalId = balanceAnchorExternalId(accountId);
  const { data: rows, error: sumError } = await supabase
    .from("transactions")
    .select("id,amount_cents,external_id")
    .eq("budget_id", budget.id)
    .eq("account_id", accountId);
  if (sumError) {
    redirectWithError(`/accounts/${accountId}`, "Could not load account balance.");
  }

  const nonAnchorSum = (rows ?? [])
    .filter((row) => row.external_id !== externalId)
    .reduce((sum, row) => sum + (row.amount_cents as number), 0);
  const anchorAmount = (balance as number) - nonAnchorSum;
  const existingAnchor = (rows ?? []).find((row) => row.external_id === externalId);
  const today = new Date().toISOString().slice(0, 10);

  if (anchorAmount === 0) {
    if (existingAnchor?.id) {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", existingAnchor.id)
        .eq("budget_id", budget.id);
      if (error) {
        redirectWithError(`/accounts/${accountId}`, "Could not clear balance adjustment.");
      }
    }
  } else if (existingAnchor?.id) {
    const { error } = await supabase
      .from("transactions")
      .update({
        amount_cents: anchorAmount,
        occurred_on: today,
        payee: "Balance adjustment",
        memo: "Manual balance set — future transactions still change this total",
        cleared: true,
      })
      .eq("id", existingAnchor.id)
      .eq("budget_id", budget.id);
    if (error) {
      redirectWithError(`/accounts/${accountId}`, "Could not update account balance.");
    }
  } else {
    const { error } = await supabase.from("transactions").insert({
      user_id: user.id,
      budget_id: budget.id,
      account_id: accountId,
      category_id: null,
      occurred_on: today,
      payee: "Balance adjustment",
      memo: "Manual balance set — future transactions still change this total",
      amount_cents: anchorAmount,
      cleared: true,
      external_id: externalId,
    });
    if (error) {
      redirectWithError(`/accounts/${accountId}`, "Could not set account balance.");
    }
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/budget");
}

export async function approveTransactionMatchAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("editor");
  const suggestionId = String(formData.get("suggestion_id") ?? "").trim();
  const accountId = String(formData.get("account_id") ?? "").trim();
  if (!suggestionId || !accountId) {
    redirect("/accounts");
  }

  const { data: suggestion, error: lookupError } = await supabase
    .from("transaction_match_suggestions")
    .select(
      "id,status,manual_transaction_id,bank_transaction_id,account_id",
    )
    .eq("id", suggestionId)
    .eq("budget_id", budget.id)
    .eq("account_id", accountId)
    .maybeSingle();

  if (lookupError || !suggestion || suggestion.status !== "pending") {
    redirectWithError(`/accounts/${accountId}`, "Match suggestion not found.");
  }

  const [manualRes, bankRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("id,category_id,payee,memo,amount_cents,occurred_on")
      .eq("budget_id", budget.id)
      .eq("id", suggestion.manual_transaction_id)
      .maybeSingle(),
    supabase
      .from("transactions")
      .select("id,external_id,amount_cents,occurred_on,payee,cleared")
      .eq("budget_id", budget.id)
      .eq("id", suggestion.bank_transaction_id)
      .maybeSingle(),
  ]);

  if (!manualRes.data?.id || !bankRes.data?.id || !bankRes.data.external_id) {
    redirectWithError(
      `/accounts/${accountId}`,
      "Linked transactions are missing. Deny this match or sync again.",
    );
  }

  const manual = manualRes.data;
  const bank = bankRes.data;
  const bankExternalId = bank.external_id as string;
  const manualId = manual.id as string;
  const bankId = bank.id as string;

  // Free the unique external_id before attaching it to the manual row.
  const { error: clearError } = await supabase
    .from("transactions")
    .update({ external_id: null })
    .eq("id", bankId)
    .eq("budget_id", budget.id);
  if (clearError) {
    redirectWithError(`/accounts/${accountId}`, "Could not approve match.");
  }

  const { error: updateError } = await supabase
    .from("transactions")
    .update({
      external_id: bankExternalId,
      amount_cents: bank.amount_cents,
      occurred_on: bank.occurred_on,
      cleared: true,
      payee: manual.payee?.trim() ? manual.payee : bank.payee,
      category_id: manual.category_id,
      memo: manual.memo,
    })
    .eq("id", manualId)
    .eq("budget_id", budget.id);

  if (updateError) {
    // Best-effort restore so the bank row stays importable.
    await supabase
      .from("transactions")
      .update({ external_id: bankExternalId })
      .eq("id", bankId)
      .eq("budget_id", budget.id);
    redirectWithError(
      `/accounts/${accountId}`,
      isUniqueViolation(updateError)
        ? "That bank transaction is already linked."
        : "Could not approve match.",
    );
  }

  await supabase
    .from("transactions")
    .delete()
    .eq("id", bankId)
    .eq("budget_id", budget.id);

  // Bank delete cascades suggestions that pointed at it; clear other pending for the manual.
  await supabase
    .from("transaction_match_suggestions")
    .delete()
    .eq("budget_id", budget.id)
    .eq("status", "pending")
    .or(
      `manual_transaction_id.eq.${manualId},bank_transaction_id.eq.${manualId}`,
    );

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/budget");
}

export async function denyTransactionMatchAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("editor");
  const suggestionId = String(formData.get("suggestion_id") ?? "").trim();
  const accountId = String(formData.get("account_id") ?? "").trim();
  if (!suggestionId || !accountId) {
    redirect("/accounts");
  }

  const { data: suggestion, error } = await supabase
    .from("transaction_match_suggestions")
    .select("id,status")
    .eq("id", suggestionId)
    .eq("budget_id", budget.id)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error || !suggestion || suggestion.status !== "pending") {
    redirectWithError(`/accounts/${accountId}`, "Match suggestion not found.");
  }

  const { error: updateError } = await supabase
    .from("transaction_match_suggestions")
    .update({ status: "denied", resolved_at: new Date().toISOString() })
    .eq("id", suggestion.id)
    .eq("budget_id", budget.id);

  if (updateError) {
    redirectWithError(`/accounts/${accountId}`, "Could not deny match.");
  }

  revalidatePath(`/accounts/${accountId}`);
}

export async function updateTransactionAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const transactionId = String(formData.get("transaction_id") ?? "");
  const fromAccountId = String(formData.get("from_account_id") ?? "").trim();
  const targetAccountId = String(formData.get("account_id") ?? "").trim();
  const payee = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();
  const occurredOn = String(formData.get("occurred_on") ?? "");
  const categoryIdRaw = String(formData.get("category_id") ?? "");
  const amount = dollarsToCents(String(formData.get("amount") ?? ""));
  const direction = String(formData.get("direction") ?? "outflow");

  const errorAccountId = fromAccountId || targetAccountId;

  if (!transactionId || !fromAccountId || !targetAccountId) {
    redirect("/accounts");
  }
  if (amount === null || amount === 0) {
    redirectWithError(`/accounts/${errorAccountId}`, "Enter a valid non-zero amount.");
  }
  const amountValue = amount as number;
  if (!isValidIsoDate(occurredOn)) {
    redirectWithError(`/accounts/${errorAccountId}`, "Invalid date.");
  }
  if (direction !== "inflow" && direction !== "outflow") {
    redirectWithError(`/accounts/${errorAccountId}`, "Invalid direction.");
  }

  const existing = await supabase
    .from("transactions")
    .select("id,account_id,external_id")
    .eq("budget_id", budget.id)
    .eq("id", transactionId)
    .eq("account_id", fromAccountId)
    .maybeSingle();
  if (!existing.data?.id) {
    redirectWithError(`/accounts/${fromAccountId}`, "Transaction not found.");
  }

  if (
    targetAccountId !== fromAccountId &&
    isBalanceAnchorExternalId(existing.data.external_id)
  ) {
    redirectWithError(
      `/accounts/${fromAccountId}`,
      "Balance adjustments stay on their account. Set the balance on the other account instead.",
    );
  }

  if (targetAccountId !== fromAccountId) {
    const target = await supabase
      .from("accounts")
      .select("id")
      .eq("budget_id", budget.id)
      .eq("id", targetAccountId)
      .maybeSingle();
    if (!target.data?.id) {
      redirectWithError(`/accounts/${fromAccountId}`, "Account not found.");
    }
  }

  const categoryId: string | null = categoryIdRaw || null;
  if (categoryId) {
    const category = await supabase
      .from("categories")
      .select("id")
      .eq("budget_id", budget.id)
      .eq("id", categoryId)
      .maybeSingle();
    if (!category.data?.id) {
      redirectWithError(`/accounts/${fromAccountId}`, "Category not found.");
    }
  }

  const amountCents =
    direction === "inflow" ? Math.abs(amountValue) : -Math.abs(amountValue);

  const { error } = await supabase
    .from("transactions")
    .update({
      account_id: targetAccountId,
      category_id: categoryId,
      occurred_on: occurredOn,
      payee,
      memo,
      amount_cents: amountCents,
    })
    .eq("budget_id", budget.id)
    .eq("id", transactionId);
  if (error) {
    redirectWithError(`/accounts/${fromAccountId}`, "Could not update transaction.");
  }

  if (targetAccountId !== fromAccountId) {
    // Match suggestions are account-scoped; drop pending ones for this txn.
    await supabase
      .from("transaction_match_suggestions")
      .delete()
      .eq("budget_id", budget.id)
      .eq("status", "pending")
      .or(
        `manual_transaction_id.eq.${transactionId},bank_transaction_id.eq.${transactionId}`,
      );
  }

  revalidatePath(`/accounts/${fromAccountId}`);
  if (targetAccountId !== fromAccountId) {
    revalidatePath(`/accounts/${targetAccountId}`);
  }
  revalidatePath("/accounts");
  revalidatePath("/budget");

  if (targetAccountId !== fromAccountId) {
    redirect(`/accounts/${targetAccountId}`);
  }
}

export async function deleteTransactionAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const transactionId = String(formData.get("transaction_id") ?? "");
  const accountId = String(formData.get("account_id") ?? "");
  if (!transactionId || !accountId) {
    redirect("/accounts");
  }

  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("budget_id", budget.id)
    .eq("id", transactionId)
    .eq("account_id", accountId);
  if (error) {
    redirectWithError(`/accounts/${accountId}`, "Could not delete transaction.");
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/budget");
}

const BATCH_DELETE_LIMIT = 500;

export async function batchDeleteTransactionsAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const accountId = String(formData.get("account_id") ?? "");
  const ids = formData
    .getAll("transaction_ids")
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (!accountId) {
    redirect("/accounts");
  }
  if (ids.length === 0) {
    redirectWithError(`/accounts/${accountId}`, "Select at least one transaction.");
  }
  if (ids.length > BATCH_DELETE_LIMIT) {
    redirectWithError(
      `/accounts/${accountId}`,
      `You can delete at most ${BATCH_DELETE_LIMIT} transactions at once.`,
    );
  }

  const { error, count } = await supabase
    .from("transactions")
    .delete({ count: "exact" })
    .eq("budget_id", budget.id)
    .eq("account_id", accountId)
    .in("id", ids);

  if (error) {
    redirectWithError(`/accounts/${accountId}`, "Could not delete selected transactions.");
  }
  if (!count) {
    redirectWithError(`/accounts/${accountId}`, "No matching transactions to delete.");
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/budget");
}

const importSchema = z.object({
  csvText: z.string().min(1).max(8_000_000),
  filename: z.string().min(1).max(255),
});

export type ImportActionResult = {
  ok: boolean;
  inserted: number;
  skipped: number;
  errors: string[];
  message?: string;
};

function fingerprintHash(row: ParsedYnabRow): string {
  return createHash("sha256").update(ynabRowFingerprint(row)).digest("hex");
}

export async function importYnabCsvAction(
  input: z.infer<typeof importSchema>,
): Promise<ImportActionResult> {
  const parsedInput = importSchema.safeParse(input);
  if (!parsedInput.success) {
    return {
      ok: false,
      inserted: 0,
      skipped: 0,
      errors: ["Invalid upload payload"],
      message: "Could not read that file.",
    };
  }

  const { supabase, user, budget } = await requireBudget("editor");
  const contentHash = createHash("sha256")
    .update(parsedInput.data.csvText)
    .digest("hex");

  const priorImport = await supabase
    .from("import_batches")
    .select("id,inserted_count,status")
    .eq("budget_id", budget.id)
    .eq("content_hash", contentHash)
    .eq("status", "completed")
    .maybeSingle();

  if (priorImport.data?.id) {
    return {
      ok: false,
      inserted: 0,
      skipped: priorImport.data.inserted_count ?? 0,
      errors: [],
      message:
        "This exact file was already imported successfully. Upload a newer export if you have additional transactions — duplicates are skipped automatically.",
    };
  }

  const { rows, skipped, errors, kind } = parseYnabCsv(parsedInput.data.csvText);

  if (kind === "unknown" || rows.length === 0) {
    return {
      ok: false,
      inserted: 0,
      skipped,
      errors,
      message:
        kind === "unknown"
          ? "Unrecognized CSV. Export YNAB Reflect → Income vs Expense, or a register CSV."
          : "No importable transactions found in that CSV.",
    };
  }

  const batch = await supabase
    .from("import_batches")
    .insert({
      user_id: user.id,
      budget_id: budget.id,
      filename: parsedInput.data.filename,
      source: kind === "reflect" ? "ynab_reflect_csv" : "ynab_csv",
      content_hash: contentHash,
      status: "pending",
      inserted_count: 0,
      skipped_count: skipped,
      error_count: errors.length,
    })
    .select("id")
    .single();

  if (batch.error || !batch.data?.id) {
    return {
      ok: false,
      inserted: 0,
      skipped,
      errors: [batch.error?.message ?? "Could not create import batch"],
      message: "Import failed before inserting rows.",
    };
  }

  const batchId = batch.data.id;

  const accountIds = new Map<string, string>();
  const groupIds = new Map<string, string>();
  const categoryIds = new Map<string, string>();

  const [
    { data: existingAccounts, error: accountsError },
    { data: existingGroups, error: groupsError },
    { data: existingCategories, error: categoriesError },
  ] = await Promise.all([
    supabase.from("accounts").select("id,name").eq("budget_id", budget.id),
    supabase.from("category_groups").select("id,name").eq("budget_id", budget.id),
    supabase.from("categories").select("id,name,group_id").eq("budget_id", budget.id),
  ]);

  if (accountsError || groupsError || categoriesError) {
    await supabase
      .from("import_batches")
      .update({ status: "failed", error_count: 1 })
      .eq("id", batchId)
      .eq("budget_id", budget.id);
    return {
      ok: false,
      inserted: 0,
      skipped,
      errors: [
        accountsError?.message ??
          groupsError?.message ??
          categoriesError?.message ??
          "Could not load existing budget entities",
      ],
      message: "Import failed before inserting rows.",
    };
  }

  for (const account of existingAccounts ?? []) {
    accountIds.set(String(account.name).toLowerCase(), account.id as string);
  }
  for (const group of existingGroups ?? []) {
    groupIds.set(String(group.name).toLowerCase(), group.id as string);
  }
  const groupNameById = new Map(
    [...groupIds.entries()].map(([name, id]) => [id, name] as const),
  );
  for (const category of existingCategories ?? []) {
    const groupKey = groupNameById.get(category.group_id as string) ?? "";
    categoryIds.set(
      `${groupKey}::${String(category.name).toLowerCase()}`,
      category.id as string,
    );
  }

  async function ensureAccount(name: string) {
    const key = name.toLowerCase();
    if (accountIds.has(key)) return accountIds.get(key)!;

    const created = await supabase
      .from("accounts")
      .insert({ user_id: user.id, budget_id: budget.id, name, account_type: "checking" })
      .select("id")
      .single();

    if (created.data?.id) {
      accountIds.set(key, created.data.id);
      return created.data.id;
    }

    if (isUniqueViolation(created.error)) {
      const again = await supabase
        .from("accounts")
        .select("id")
        .eq("budget_id", budget.id)
        .ilike("name", escapeIlikeExact(name))
        .maybeSingle();
      if (again.data?.id) {
        accountIds.set(key, again.data.id);
        return again.data.id;
      }
    }

    throw new Error(created.error?.message ?? `Failed to create account ${name}`);
  }

  async function ensureCategory(groupName: string, categoryName: string) {
    if (!categoryName) return null;
    const resolvedGroup = groupName || "Imported";
    const mapKey = `${resolvedGroup.toLowerCase()}::${categoryName.toLowerCase()}`;
    if (categoryIds.has(mapKey)) return categoryIds.get(mapKey)!;

    let groupId = groupIds.get(resolvedGroup.toLowerCase());
    if (!groupId) {
      const createdGroup = await supabase
        .from("category_groups")
        .insert({ user_id: user.id, budget_id: budget.id, name: resolvedGroup })
        .select("id")
        .single();

      if (createdGroup.data?.id) {
        groupId = createdGroup.data.id;
      } else if (isUniqueViolation(createdGroup.error)) {
        const again = await supabase
          .from("category_groups")
          .select("id")
          .eq("budget_id", budget.id)
          .ilike("name", escapeIlikeExact(resolvedGroup))
          .maybeSingle();
        groupId = again.data?.id;
      }

      if (!groupId) {
        throw new Error(createdGroup.error?.message ?? "Failed to create category group");
      }
      groupIds.set(resolvedGroup.toLowerCase(), groupId);
    }

    const createdCategory = await supabase
      .from("categories")
      .insert({
        user_id: user.id,
        budget_id: budget.id,
        group_id: groupId,
        name: categoryName,
      })
      .select("id")
      .single();

    if (createdCategory.data?.id) {
      categoryIds.set(mapKey, createdCategory.data.id);
      return createdCategory.data.id;
    }

    if (isUniqueViolation(createdCategory.error)) {
      const again = await supabase
        .from("categories")
        .select("id")
        .eq("budget_id", budget.id)
        .eq("group_id", groupId)
        .ilike("name", escapeIlikeExact(categoryName))
        .maybeSingle();
      if (again.data?.id) {
        categoryIds.set(mapKey, again.data.id);
        return again.data.id;
      }
    }

    throw new Error(createdCategory.error?.message ?? "Failed to create category");
  }

  const payload: Array<{
    user_id: string;
    budget_id: string;
    account_id: string;
    category_id: string | null;
    occurred_on: string;
    payee: string;
    memo: string;
    amount_cents: number;
    cleared: boolean;
    import_batch_id: string;
    import_fingerprint: string;
  }> = [];
  let localSkipped = skipped;
  const localErrors = [...errors];

  for (const row of rows) {
    try {
      const accountId = await ensureAccount(row.accountName);
      const categoryId = await ensureCategory(row.categoryGroup, row.categoryName);
      payload.push({
        user_id: user.id,
        budget_id: budget.id,
        account_id: accountId,
        category_id: categoryId,
        occurred_on: row.occurredOn,
        payee: row.payee,
        memo: row.memo,
        amount_cents: row.amountCents,
        cleared: true,
        import_batch_id: batchId,
        import_fingerprint: fingerprintHash(row),
      });
    } catch (error) {
      localSkipped += 1;
      localErrors.push(error instanceof Error ? error.message : "Row failed");
    }
  }

  let inserted = 0;
  let duplicateSkipped = 0;
  const chunkSize = 200;
  let hardFailure = false;

  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const insertResult = await supabase.from("transactions").insert(chunk).select("id");

    if (!insertResult.error) {
      inserted += insertResult.data?.length ?? chunk.length;
      continue;
    }

    if (!isUniqueViolation(insertResult.error)) {
      hardFailure = true;
      localErrors.push(insertResult.error.message);
      localSkipped += chunk.length;
      continue;
    }

    // Chunk collided with existing fingerprints — insert row-by-row so new rows still land.
    for (const row of chunk) {
      const one = await supabase.from("transactions").insert(row).select("id");
      if (one.data?.length) {
        inserted += one.data.length;
      } else if (isUniqueViolation(one.error)) {
        duplicateSkipped += 1;
      } else if (one.error) {
        hardFailure = true;
        localErrors.push(one.error.message);
        localSkipped += 1;
      }
    }
  }

  localSkipped += duplicateSkipped;

  // Completed only when every prepared row was inserted or already present.
  // Failed/partial batches stay retryable (content_hash unique only applies to completed).
  // Row fingerprints still prevent duplicates on retry.
  const allResolved =
    payload.length > 0 && inserted + duplicateSkipped === payload.length && !hardFailure;
  const finalStatus: "completed" | "failed" = allResolved ? "completed" : "failed";

  await supabase
    .from("import_batches")
    .update({
      status: finalStatus,
      inserted_count: inserted,
      skipped_count: localSkipped,
      error_count: localErrors.length,
    })
    .eq("id", batchId)
    .eq("budget_id", budget.id);

  revalidatePath("/budget");
  revalidatePath("/accounts");
  revalidatePath("/import");

  const ok = inserted > 0 || (duplicateSkipped > 0 && finalStatus === "completed");
  return {
    ok,
    inserted,
    skipped: localSkipped,
    errors: localErrors.slice(0, 25),
    message:
      inserted > 0
        ? `Imported ${inserted} new transaction${inserted === 1 ? "" : "s"}${
            duplicateSkipped > 0 ? ` (${duplicateSkipped} already present skipped)` : ""
          }.`
        : duplicateSkipped > 0 && finalStatus === "completed"
          ? `No new transactions — ${duplicateSkipped} already imported from a previous export.`
          : finalStatus === "failed"
            ? "Import failed. You can retry this file; incomplete imports are not locked out."
            : "Import finished without inserting rows.",
  };
}


// ── Budget / household management ───────────────────────────────────

export async function switchBudgetAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  const budgetId = String(formData.get("budget_id") ?? "");
  if (!budgetId) redirectWithError("/settings", "Budget required.");

  const membership = await supabase
    .from("budget_members")
    .select("role")
    .eq("budget_id", budgetId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership.data) {
    redirectWithError("/settings", "You are not a member of that budget.");
  }

  await setActiveBudgetId(budgetId);
  await supabase.from("profiles").update({ current_budget_id: budgetId }).eq("id", user.id);
  revalidatePath("/", "layout");
  redirect("/budget");
}

export async function createBudgetAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("name") ?? "").trim() || "New budget";
  const created = await supabase
    .from("budgets")
    .insert({ name, created_by: user.id })
    .select("id")
    .single();
  if (created.error || !created.data?.id) {
    redirectWithError("/settings", "Could not create budget.");
  }
  const newBudgetId = created.data!.id;
  await supabase.from("budget_members").insert({
    budget_id: newBudgetId,
    user_id: user.id,
    role: "owner",
  });
  await setActiveBudgetId(newBudgetId);
  await supabase.from("profiles").update({ current_budget_id: newBudgetId }).eq("id", user.id);
  revalidatePath("/", "layout");
  redirect("/settings");
}

export async function renameBudgetAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("admin");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirectWithError("/settings", "Budget name is required.");
  const { error } = await supabase
    .from("budgets")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", budget.id);
  if (error) redirectWithError("/settings", "Could not rename budget.");
  revalidatePath("/", "layout");
  redirect("/settings");
}

export async function deleteBudgetAction(formData: FormData) {
  const { supabase, user, budget, role } = await requireBudget("owner");
  const confirmName = String(formData.get("confirm_name") ?? "").trim();
  if (confirmName !== budget.name) {
    redirectWithError("/settings", "Type the budget name exactly to delete it.");
  }
  if (role !== "owner") {
    redirectWithError("/settings", "Only an owner can delete a budget.");
  }

  const { error } = await supabase.from("budgets").delete().eq("id", budget.id);
  if (error) redirectWithError("/settings", "Could not delete budget.");

  await supabase.from("profiles").update({ current_budget_id: null }).eq("id", user.id);
  revalidatePath("/", "layout");
  redirect("/settings");
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Role invite with unlimited uses. Returns a complete URL for the client UI. */
export async function generateRoleInviteAction(
  roleInput: string,
): Promise<
  | { ok: true; url: string; token: string; role: BudgetRole }
  | { ok: false; error: string }
> {
  const { supabase, user, budget } = await requireBudget("admin");
  const role = roleInput as BudgetRole;
  if (!["owner", "admin", "editor", "viewer"].includes(role)) {
    return { ok: false, error: "Invalid role." };
  }

  const token = createHash("sha256")
    .update(`${budget.id}:${user.id}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 48);
  const tokenHash = hashInviteToken(token);
  const { error } = await supabase.from("budget_invites").insert({
    budget_id: budget.id,
    token_hash: tokenHash,
    kind: "role",
    role,
    created_by: user.id,
    expires_at: null,
    max_uses: null,
  });
  if (error) return { ok: false, error: "Could not create invite link." };

  const url = absoluteUrl(`/invite/${token}`);
  if (!url.startsWith("http")) {
    return {
      ok: false,
      error:
        "Set NEXT_PUBLIC_SITE_URL in Doppler so invite links are absolute (e.g. https://your-app.vercel.app).",
    };
  }

  revalidatePath("/settings");
  return { ok: true, url, token, role };
}

/** @deprecated Prefer generateRoleInviteAction — kept for any leftover forms. */
export async function createInviteLinkAction(formData: FormData) {
  const role = String(formData.get("role") ?? "editor");
  const result = await generateRoleInviteAction(role);
  if (!result.ok) redirectWithError("/settings", result.error);
  redirect(`/settings?invite=${encodeURIComponent(result.token)}&kind=role`);
}

export async function revokeInviteAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("admin");
  const inviteId = String(formData.get("invite_id") ?? "");
  if (!inviteId) redirectWithError("/settings", "Invite required.");
  const { data: updated, error } = await supabase
    .from("budget_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("budget_id", budget.id)
    .select("id");
  if (error) redirectWithError("/settings", "Could not revoke invite.");
  if (!updated?.length) {
    redirectWithError("/settings", "Invite not found or already revoked.");
  }
  revalidatePath("/settings");
  redirect("/settings?notice=" + encodeURIComponent("Invite link revoked."));
}

export async function deleteInviteAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("admin");
  const inviteId = String(formData.get("invite_id") ?? "").trim();
  if (!inviteId) redirectWithError("/settings", "Invite required.");

  const { data: invite, error: lookupError } = await supabase
    .from("budget_invites")
    .select("id,revoked_at")
    .eq("id", inviteId)
    .eq("budget_id", budget.id)
    .maybeSingle();

  if (lookupError || !invite) {
    redirectWithError("/settings", "Invite not found.");
  }
  if (!invite.revoked_at) {
    redirectWithError(
      "/settings",
      "Revoke the invite first, then you can delete it from history.",
    );
  }

  // Prefer RPC (bypasses missing DELETE RLS while still checking admin + revoked).
  const rpc = await supabase.rpc("delete_revoked_budget_invite", {
    p_invite_id: inviteId,
  });

  if (!rpc.error) {
    revalidatePath("/settings");
    redirect("/settings?notice=" + encodeURIComponent("Invite link deleted."));
  }

  // Fallback: direct delete (needs budget_invites DELETE policy).
  const missingRpc = /could not find the function|schema cache|does not exist/i.test(
    rpc.error.message,
  );
  if (!missingRpc) {
    redirectWithError(
      "/settings",
      rpc.error.message.slice(0, 160) || "Could not delete invite.",
    );
  }

  const { data: deleted, error } = await supabase
    .from("budget_invites")
    .delete()
    .eq("id", inviteId)
    .eq("budget_id", budget.id)
    .select("id");

  if (error) {
    redirectWithError(
      "/settings",
      /policy|permission|rls|denied/i.test(error.message)
        ? "Could not delete invite. Run the latest Supabase invite migrations."
        : `Could not delete invite: ${error.message.slice(0, 160)}`,
    );
  }
  if (!deleted?.length) {
    redirectWithError(
      "/settings",
      "Could not delete invite. Run supabase/migrations/20260725010000_delete_revoked_invite_rpc.sql in Supabase.",
    );
  }

  revalidatePath("/settings");
  redirect("/settings?notice=" + encodeURIComponent("Invite link deleted."));
}

export async function acceptInviteAction(formData: FormData) {
  const { supabase } = await requireUser();
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirectWithError("/login", "Invite token missing.");
  const tokenHash = hashInviteToken(token);
  const { data, error } = await supabase.rpc("accept_budget_invite", {
    p_token_hash: tokenHash,
  });
  if (error) {
    redirectWithError(`/invite/${token}`, error.message);
  }
  const budgetId = String(data);
  await setActiveBudgetId(budgetId);
  revalidatePath("/", "layout");
  redirect("/budget");
}

export async function updateMemberRoleAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("admin");
  const memberId = String(formData.get("member_id") ?? "");
  const role = String(formData.get("role") ?? "") as BudgetRole;
  if (!memberId || !["owner", "admin", "editor", "viewer"].includes(role)) {
    redirectWithError("/settings", "Invalid member update.");
  }
  const { error } = await supabase
    .from("budget_members")
    .update({ role })
    .eq("id", memberId)
    .eq("budget_id", budget.id);
  if (error) redirectWithError("/settings", "Could not update member role.");
  revalidatePath("/settings");
}

export async function removeMemberAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("admin");
  const memberUserId = String(formData.get("user_id") ?? "");
  if (!memberUserId) redirectWithError("/settings", "Member required.");
  if (memberUserId === user.id) {
    redirectWithError("/settings", "Use Leave budget to remove yourself.");
  }
  const { error } = await supabase
    .from("budget_members")
    .delete()
    .eq("budget_id", budget.id)
    .eq("user_id", memberUserId);
  if (error) redirectWithError("/settings", "Could not remove member.");
  revalidatePath("/settings");
}

export async function leaveBudgetAction() {
  const { supabase, user, budget, role } = await requireBudget("viewer");
  if (role === "owner") {
    const owners = await supabase
      .from("budget_members")
      .select("id")
      .eq("budget_id", budget.id)
      .eq("role", "owner");
    if ((owners.data?.length ?? 0) <= 1) {
      redirectWithError(
        "/settings",
        "Transfer ownership before leaving as the only owner.",
      );
    }
  }
  const { error } = await supabase
    .from("budget_members")
    .delete()
    .eq("budget_id", budget.id)
    .eq("user_id", user.id);
  if (error) redirectWithError("/settings", "Could not leave budget.");
  await supabase.from("profiles").update({ current_budget_id: null }).eq("id", user.id);
  revalidatePath("/", "layout");
  redirect("/settings");
}

export async function disconnectPlaidItemAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("admin");
  const itemId = String(formData.get("item_id") ?? "");
  if (!itemId) redirectWithError("/settings", "Bank connection required.");

  const { data: item } = await supabase
    .from("plaid_items")
    .select("id,access_token_encrypted,status")
    .eq("id", itemId)
    .eq("budget_id", budget.id)
    .maybeSingle();

  if (item?.access_token_encrypted && item.status !== "disconnected") {
    try {
      const { getPlaidClient, plaidConfigured } = await import("@/lib/plaid/client");
      const { decryptSecret } = await import("@/lib/crypto/secrets");
      if (plaidConfigured()) {
        const client = getPlaidClient();
        await client.itemRemove({
          access_token: decryptSecret(item.access_token_encrypted),
        });
      }
    } catch {
      // Still disconnect locally if Plaid itemRemove fails (already revoked, etc.).
    }
  }

  await supabase
    .from("plaid_accounts")
    .delete()
    .eq("plaid_item_id", itemId)
    .eq("budget_id", budget.id);

  const { error } = await supabase
    .from("plaid_items")
    .update({
      status: "disconnected",
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", itemId)
    .eq("budget_id", budget.id);

  if (error) redirectWithError("/settings", "Could not disconnect bank.");
  revalidatePath("/settings");
  revalidatePath("/accounts");
  redirect("/settings");
}

export async function syncPlaidNowAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("admin");
  const itemId = String(formData.get("item_id") ?? "");
  if (!itemId) redirectWithError("/settings", "Bank connection required.");

  const { data: item, error } = await supabase
    .from("plaid_items")
    .select("id,budget_id,access_token_encrypted,sync_cursor,created_by,status")
    .eq("id", itemId)
    .eq("budget_id", budget.id)
    .maybeSingle();

  if (error || !item || item.status === "disconnected") {
    redirectWithError("/settings", "Bank connection not found.");
  }

  const { syncPlaidItem } = await import("@/lib/plaid/sync");
  const started = new Date().toISOString();
  const result = await syncPlaidItem(supabase, item!);
  await supabase.from("sync_runs").insert({
    budget_id: budget.id,
    plaid_item_id: item!.id,
    source: "manual",
    started_at: started,
    finished_at: new Date().toISOString(),
    inserted: result.inserted,
    updated: result.updated,
    errors: result.errors.length ? result.errors.join("\n").slice(0, 4000) : null,
  });

  revalidatePath("/settings");
  revalidatePath("/accounts");
  if (result.errors.length) {
    redirectWithError("/settings", result.errors[0] || "Sync finished with errors.");
  }
  redirect("/settings");
}


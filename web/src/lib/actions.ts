"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import {
  budgetPagePath,
  currentBudgetMonth,
  dollarsToCents,
  formatCents,
  isBudgetMonth,
  isValidIsoDate,
  maxAssignableBudgetMonth,
} from "@/lib/money";
import {
  distributeByPercent,
  distributeByPriority,
  priorityNeedCents,
  type AutoAssignMode,
} from "@/lib/auto-assign";
import { getBudgetRows } from "@/lib/budget-data";
import { requireBudget, setActiveBudgetId } from "@/lib/budget-context";
import { hasRecentPrimarySignIn } from "@/lib/auth/reauth";
import {
  isPasskeyApiUnavailable,
  resolvePasswordLoginGate,
} from "@/lib/passkey-gate";
import {
  clearPasswordResetGrant,
  createRecoveryState,
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
import {
  READY_TO_ASSIGN_TARGET_ID,
  validateOverspendTransferPlan,
} from "@/lib/overspend-fix";
import { suggestCategoryForPayee } from "@/lib/payee-categorization";
import {
  balanceAnchorExternalId,
  isBalanceAnchorExternalId,
  isBankExternalId,
  suggestMatchForManualTransaction,
} from "@/lib/transaction-matching";
import {
  listRecentBudgetChanges,
  recordBudgetChange,
  restoreBudgetChange,
  type BudgetChangeLogRow,
} from "@/lib/change-log";

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
  if (!hasRecentPrimarySignIn(user.last_sign_in_at)) {
    await supabase.auth.signOut();
    redirect(
      "/login?error=" +
        encodeURIComponent("Your 14-day session expired. Sign in again to continue."),
    );
  }
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

async function countUserPasskeys(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ ok: true; count: number } | { ok: false }> {
  try {
    const { data, error } = await supabase.auth.passkey.list();
    if (error) {
      if (isPasskeyApiUnavailable(error)) return { ok: false };
      return { ok: false };
    }
    return { ok: true, count: data?.length ?? 0 };
  } catch (error) {
    if (
      isPasskeyApiUnavailable(
        error instanceof Error ? { message: error.message } : null,
      )
    ) {
      return { ok: false };
    }
    return { ok: false };
  }
}

/**
 * After password auth: optionally offer passkey enrollment, otherwise continue.
 * Password and passkey are both valid sign-in methods with no email step.
 */
async function finishPasswordAuth(options: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  next: string;
}): Promise<never> {
  const passkeys = await countUserPasskeys(options.supabase);
  const gate = resolvePasswordLoginGate({
    passkeyCount: passkeys.ok ? passkeys.count : null,
    passkeyCheckOk: passkeys.ok,
    next: options.next,
  });

  if (gate.kind === "passkey_setup") {
    redirect(
      `/passkey-setup?next=${encodeURIComponent(gate.next)}`,
    );
  }

  redirect(gate.next);
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
  await finishPasswordAuth({ supabase, next });
}

export async function signUpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const next = safeInternalPath(String(formData.get("next") ?? "/budget"));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName || email.split("@")[0] },
    },
  });
  if (error) {
    redirectWithError("/login", error.message, "&mode=signup");
  }
  // Email confirmation may leave the user without a session yet.
  if (!data.session) {
    redirect(
      `/login?notice=${encodeURIComponent(
        "Check your email to confirm your account, then sign in.",
      )}&mode=signup`,
    );
  }
  await finishPasswordAuth({ supabase, next });
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearPasswordResetGrant();
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

const FEEDBACK_KINDS = new Set(["feedback", "request", "bug"]);
const FEEDBACK_MAX_LEN = 4000;
const FEEDBACK_RATE_LIMIT = 10;
const FEEDBACK_RATE_WINDOW_MS = 60 * 60 * 1000;

/** Submit product feedback / feature request / bug report from Settings. */
export async function submitFeedbackAction(
  formData: FormData,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { supabase, user, budget } = await requireBudget("viewer");
  const kind = String(formData.get("kind") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  if (!FEEDBACK_KINDS.has(kind)) {
    return { ok: false, error: "Choose a feedback type." };
  }
  if (message.length < 3) {
    return { ok: false, error: "Please write a bit more detail (at least 3 characters)." };
  }
  if (message.length > FEEDBACK_MAX_LEN) {
    return {
      ok: false,
      error: `Keep feedback to ${FEEDBACK_MAX_LEN} characters or fewer.`,
    };
  }

  const since = new Date(Date.now() - FEEDBACK_RATE_WINDOW_MS).toISOString();
  const { count, error: countError } = await supabase
    .from("app_feedback")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  if (countError) {
    return {
      ok: false,
      error:
        "Feedback isn’t available yet. Apply the latest Supabase feedback migration, then try again.",
    };
  }
  if ((count ?? 0) >= FEEDBACK_RATE_LIMIT) {
    return {
      ok: false,
      error: "You’ve sent several notes recently. Try again in a bit.",
    };
  }

  const { error } = await supabase.from("app_feedback").insert({
    user_id: user.id,
    budget_id: budget.id,
    kind,
    message,
  });
  if (error) {
    return {
      ok: false,
      error:
        /relation|schema cache|does not exist/i.test(error.message)
          ? "Feedback isn’t available yet. Apply supabase/migrations/20260726020000_app_feedback.sql in Supabase."
          : "Could not send feedback. Try again.",
    };
  }

  revalidatePath("/settings");
  return {
    ok: true,
    message: "Thanks — your note was sent.",
  };
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
    redirectTo: absoluteUrl(
      `/auth/callback?next=/settings/password&recovery_state=${encodeURIComponent(
        createRecoveryState(user.id),
      )}`,
    ),
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
  const { user } = await requireUser();
  if (!(await hasPasswordResetGrant(user.id))) {
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
  const { supabase, user, budget } = await requireBudget("editor");
  const accountId = String(formData.get("account_id") ?? "").trim();
  if (!accountId) {
    redirectWithError("/accounts", "Account not found.");
  }

  const { data: account, error: lookupError } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .eq("budget_id", budget.id)
    .maybeSingle();

  if (lookupError || !account) {
    redirectWithError("/accounts", "Account not found.");
  }

  const { data: accountTxns } = await supabase
    .from("transactions")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("account_id", accountId);

  await recordBudgetChange(supabase, {
    budgetId: budget.id,
    actorUserId: user.id,
    entityType: "account",
    entityId: accountId,
    action: "delete",
    summary: `Deleted account “${account.name}” (${(accountTxns ?? []).length} transactions)`,
    beforeSnapshot: {
      account,
      transactions: accountTxns ?? [],
    },
  });

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
  revalidatePath("/transactions");
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
    dueOnEnabled?: boolean;
    dueOn?: string;
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

  let goalDueOn: string | null = null;
  if (goalCents != null && input.dueOnEnabled) {
    const dueOn = String(input.dueOn ?? "").trim();
    if (!isValidIsoDate(dueOn)) {
      return { ok: false, error: "Pick a valid due date, or turn due date off." };
    }
    goalDueOn = dueOn;
  }

  const owned = await supabase
    .from("categories")
    .select("id")
    .eq("budget_id", budget.id)
    .eq("id", categoryId)
    .maybeSingle();
  if (!owned.data?.id) return { ok: false, error: "Category not found." };

  const payload = {
    goal_cents: goalCents,
    goal_name: goalCents == null ? "" : input.goalName.trim().slice(0, 120),
    goal_frequency: frequency,
    goal_note: goalCents == null ? "" : input.note.trim().slice(0, 500),
    goal_due_on: goalDueOn,
  };

  let { error } = await supabase
    .from("categories")
    .update(payload)
    .eq("budget_id", budget.id)
    .eq("id", categoryId);

  if (error && /goal_due_on|column|schema cache/i.test(error.message)) {
    const withoutDue = {
      goal_cents: payload.goal_cents,
      goal_name: payload.goal_name,
      goal_frequency: payload.goal_frequency,
      goal_note: payload.goal_note,
    };
    ({ error } = await supabase
      .from("categories")
      .update(withoutDue)
      .eq("budget_id", budget.id)
      .eq("id", categoryId));
    if (!error && goalDueOn) {
      return {
        ok: false,
        error: "Run the goal due-date migration in Supabase, then try again.",
      };
    }
  }

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
    dueOnEnabled: false,
    dueOn: "",
  });
}

export async function renameCategoryAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const categoryId = String(formData.get("category_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!categoryId || !name) {
    redirectWithError("/budget", "Category name is required.");
  }

  const { data: before } = await supabase
    .from("categories")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("id", categoryId)
    .maybeSingle();

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

  if (before) {
    await recordBudgetChange(supabase, {
      budgetId: budget.id,
      actorUserId: user.id,
      entityType: "category",
      entityId: categoryId,
      action: "update",
      summary: `Renamed category “${before.name}” → “${name}”`,
      beforeSnapshot: { category: before },
      afterSnapshot: { category: { ...before, name } },
    });
  }

  revalidatePath("/budget");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
}

export async function deleteCategoryAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const categoryId = String(formData.get("category_id") ?? "");
  if (!categoryId) {
    redirectWithError("/budget", "Category not found.");
  }

  const { data: category } = await supabase
    .from("categories")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("id", categoryId)
    .maybeSingle();
  if (!category) {
    redirectWithError("/budget", "Category not found.");
  }

  const [{ data: months }, { data: linkedTxns }] = await Promise.all([
    supabase
      .from("category_months")
      .select("*")
      .eq("budget_id", budget.id)
      .eq("category_id", categoryId),
    supabase
      .from("transactions")
      .select("id")
      .eq("budget_id", budget.id)
      .eq("category_id", categoryId),
  ]);

  await recordBudgetChange(supabase, {
    budgetId: budget.id,
    actorUserId: user.id,
    entityType: "category",
    entityId: categoryId,
    action: "delete",
    summary: `Deleted category “${category.name}”`,
    beforeSnapshot: {
      category,
      category_months: months ?? [],
      linked_transaction_ids: (linkedTxns ?? []).map((row) => row.id),
    },
  });

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
  revalidatePath("/transactions");
}

/** Toggle whether Fix Now may pull from this category to cover overspending. */
export async function toggleCategoryOverspendCoverAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("editor");
  const categoryId = String(formData.get("category_id") ?? "");
  if (!categoryId) {
    redirectWithError("/budget", "Category not found.");
  }

  const { data: category, error: loadError } = await supabase
    .from("categories")
    .select("id,name,exclude_from_overspend_cover")
    .eq("budget_id", budget.id)
    .eq("id", categoryId)
    .maybeSingle();

  if (loadError) {
    redirectWithError(
      "/budget",
      /exclude_from_overspend|column|schema cache/i.test(loadError.message)
        ? "Run the exclude_from_overspend_cover migration in Supabase, then try again."
        : "Could not update category.",
    );
  }
  if (!category) {
    redirectWithError("/budget", "Category not found.");
  }

  const next = !Boolean(category!.exclude_from_overspend_cover);
  const { error } = await supabase
    .from("categories")
    .update({ exclude_from_overspend_cover: next })
    .eq("budget_id", budget.id)
    .eq("id", categoryId);
  if (error) {
    redirectWithError(
      "/budget",
      /exclude_from_overspend|column|schema cache/i.test(error.message)
        ? "Run the exclude_from_overspend_cover migration in Supabase, then try again."
        : "Could not update category.",
    );
  }

  revalidatePath("/budget");
}

export async function renameCategoryGroupAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const groupId = String(formData.get("group_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!groupId || !name) {
    redirectWithError("/budget", "Group name is required.");
  }

  const { data: before } = await supabase
    .from("category_groups")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("id", groupId)
    .maybeSingle();

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

  if (before) {
    await recordBudgetChange(supabase, {
      budgetId: budget.id,
      actorUserId: user.id,
      entityType: "category_group",
      entityId: groupId,
      action: "update",
      summary: `Renamed group “${before.name}” → “${name}”`,
      beforeSnapshot: { group: before },
      afterSnapshot: { group: { ...before, name } },
    });
  }

  revalidatePath("/budget");
  revalidatePath("/accounts");
}

export async function deleteCategoryGroupAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const groupId = String(formData.get("group_id") ?? "");
  if (!groupId) {
    redirectWithError("/budget", "Group not found.");
  }

  const { data: group } = await supabase
    .from("category_groups")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("id", groupId)
    .maybeSingle();
  if (!group) {
    redirectWithError("/budget", "Group not found.");
  }

  const { data: categories } = await supabase
    .from("categories")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("group_id", groupId);
  const categoryIds = (categories ?? []).map((row) => row.id as string);

  let months: Record<string, unknown>[] = [];
  const linkedByCategory: Record<string, string[]> = {};
  if (categoryIds.length) {
    const [monthsRes, linkedRes] = await Promise.all([
      supabase
        .from("category_months")
        .select("*")
        .eq("budget_id", budget.id)
        .in("category_id", categoryIds),
      supabase
        .from("transactions")
        .select("id,category_id")
        .eq("budget_id", budget.id)
        .in("category_id", categoryIds),
    ]);
    months = (monthsRes.data ?? []) as Record<string, unknown>[];
    for (const txn of linkedRes.data ?? []) {
      const catId = String(txn.category_id);
      if (!linkedByCategory[catId]) linkedByCategory[catId] = [];
      linkedByCategory[catId].push(String(txn.id));
    }
  }

  await recordBudgetChange(supabase, {
    budgetId: budget.id,
    actorUserId: user.id,
    entityType: "category_group",
    entityId: groupId,
    action: "delete",
    summary: `Deleted group “${group.name}” (${categoryIds.length} categories)`,
    beforeSnapshot: {
      group,
      categories: categories ?? [],
      category_months: months,
      linked_transaction_ids_by_category: linkedByCategory,
    },
  });

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
  revalidatePath("/transactions");
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
    budgetError(options.month, "Could not save budget month.");
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
    budgetError(options.month, "Could not save assignment.");
  }
}

function budgetError(month: string, message: string): never {
  redirect(
    budgetPagePath({
      month,
      error: message,
    }),
  );
}

/** One amount box: +, −, set, auto:%, auto:#, AP */
export async function categoryAmountAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const categoryId = String(formData.get("category_id") ?? "");
  const month = String(formData.get("month") ?? currentBudgetMonth());
  const intent = String(formData.get("intent") ?? "");
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const liveMonth = currentBudgetMonth();
  const maxFuture = maxAssignableBudgetMonth(liveMonth);

  if (
    !categoryId ||
    !isBudgetMonth(month) ||
    month < liveMonth ||
    (maxFuture != null && month > maxFuture)
  ) {
    budgetError(liveMonth, "Invalid assignment.");
  }

  const owned = await supabase
    .from("categories")
    .select("id")
    .eq("budget_id", budget.id)
    .eq("id", categoryId)
    .maybeSingle();
  if (!owned.data?.id) {
    budgetError(month, "Category not found.");
  }

  if (intent === "auto_percent") {
    const percent = Number(amountRaw);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      budgetError(month, "Enter a percentage between 0 and 100.");
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
      budgetError(
        month,
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
      budgetError(month, "Enter a valid dollar amount for auto:#.");
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
      budgetError(
        month,
        /assign_mode|assign_fixed|column|schema cache/i.test(error.message)
          ? "Run the assign_fixed_cents migration in Supabase, then try again."
          : "Could not save auto:# rule.",
      );
    }
    revalidatePath("/budget");
    return;
  }

  if (intent === "auto_priority") {
    const priority = Number(amountRaw || "0");
    if (
      !Number.isFinite(priority) ||
      !Number.isInteger(priority) ||
      priority < 0 ||
      priority > 9999
    ) {
      budgetError(
        month,
        "Enter a whole-number AP priority (0 clears; 1 funds before 2).",
      );
    }
    const { error } = await supabase
      .from("categories")
      .update({ assign_priority: priority })
      .eq("budget_id", budget.id)
      .eq("id", categoryId);
    if (error) {
      budgetError(
        month,
        /assign_priority|column|schema cache/i.test(error.message)
          ? "Run the assign_priority migration in Supabase, then try again."
          : "Could not save AP priority.",
      );
    }
    revalidatePath("/budget");
    return;
  }

  const delta = dollarsToCents(amountRaw || "0");
  if (delta === null) {
    budgetError(month, "Enter a valid dollar amount.");
  }

  const currentRes = await supabase
    .from("category_months")
    .select("assigned_cents")
    .eq("budget_id", budget.id)
    .eq("category_id", categoryId)
    .eq("month", month)
    .maybeSingle();
  if (currentRes.error) {
    budgetError(month, "Could not load current assignment.");
  }
  const current = Number(currentRes.data?.assigned_cents ?? 0);

  let next = current;
  if (intent === "add") next = current + delta;
  else if (intent === "sub") next = current - delta;
  else if (intent === "set") next = delta;
  else budgetError(month, "Unknown amount action.");

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
  const liveMonth = currentBudgetMonth();
  const maxFuture = maxAssignableBudgetMonth(liveMonth);
  if (
    !isBudgetMonth(month) ||
    month < liveMonth ||
    (maxFuture != null && month > maxFuture)
  ) {
    budgetError(liveMonth, "Invalid month.");
  }

  const modeRaw = String(formData.get("mode") ?? "regular");
  const mode: AutoAssignMode =
    modeRaw === "priority" ? "priority" : "regular";

  const { readyToAssignCents, rows } = await getBudgetRows(month);
  if (readyToAssignCents <= 0) {
    budgetError(
      month,
      "Ready to assign is not positive. Use Fix Now to cover the shortfall first.",
    );
  }

  const distributed =
    mode === "priority"
      ? distributeByPriority(
          readyToAssignCents,
          rows.map((row) => ({
            categoryId: row.categoryId,
            assignPriority: row.assignPriority,
            needCents: priorityNeedCents({
              goalCents: row.goalCents,
              availableCents: row.availableCents,
              assignFixedCents: row.assignFixedCents,
            }),
            currentAssignedCents: row.assignedCents,
          })),
        )
      : distributeByPercent(
          readyToAssignCents,
          rows.map((row) => ({
            categoryId: row.categoryId,
            assignMode: row.assignMode,
            assignPercent: row.assignPercent,
            assignFixedCents: row.assignFixedCents,
            currentAssignedCents: row.assignedCents,
          })),
        );

  const { assignments, totalAdded, error: distError } = distributed;
  if (distError) {
    budgetError(month, distError);
  }
  if (totalAdded <= 0) {
    budgetError(month, "Nothing to auto-assign.");
  }

  const touchedCategoryIds = assignments
    .filter((assignment) => assignment.addedCents > 0)
    .map((assignment) => assignment.categoryId);

  const { data: beforeMonths } = await supabase
    .from("category_months")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("month", month);

  const monthUpsert = await supabase.from("budget_months").upsert(
    { user_id: user.id, budget_id: budget.id, month },
    { onConflict: "budget_id,month" },
  );
  if (monthUpsert.error) {
    budgetError(month, "Could not save budget month.");
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
      budgetError(month, "Auto-assign failed partway — try again.");
    }
  }

  const { data: afterMonths } = await supabase
    .from("category_months")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("month", month);

  await recordBudgetChange(supabase, {
    budgetId: budget.id,
    actorUserId: user.id,
    entityType: "assignment",
    entityId: null,
    action: "update",
    summary: `${mode === "priority" ? "Priority auto-assigned" : "Auto-assigned"} ${formatCents(totalAdded)} for ${month}`,
    beforeSnapshot: {
      kind: "auto_assign",
      mode,
      month,
      category_months: beforeMonths ?? [],
      touched_category_ids: touchedCategoryIds,
    },
    afterSnapshot: {
      kind: "auto_assign",
      mode,
      month,
      category_months: afterMonths ?? [],
      touched_category_ids: touchedCategoryIds,
      total_added_cents: totalAdded,
    },
  });

  revalidatePath("/budget");
  revalidatePath("/settings");
  redirect(budgetPagePath({ month, assigned: totalAdded }));
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
  if (
    !payload ||
    !Array.isArray(payload.donations) ||
    !Array.isArray(payload.allocations) ||
    payload.donations.length > 500 ||
    payload.allocations.length > 1000
  ) {
    return { ok: false, error: "Invalid or oversized budget fix." };
  }
  const month = isBudgetMonth(payload.month) ? payload.month : currentBudgetMonth();

  const donations = payload.donations;
  const allocations = payload.allocations;
  const plan = validateOverspendTransferPlan(donations, allocations);
  if (!plan.ok) return plan;

  const lockToken = crypto.randomUUID();
  const lock = await supabase.rpc("acquire_overspend_fix_lock", {
    p_budget_id: budget.id,
    p_month: month,
    p_lock_token: lockToken,
  });
  if (lock.error) {
    return {
      ok: false,
      error: "Could not secure this fix. Apply the latest security migration.",
    };
  }
  if (!lock.data) {
    return {
      ok: false,
      error: "Another budget fix is already in progress. Try again shortly.",
    };
  }

  try {
    const { rows } = await getBudgetRows(month);
    const rowById = new Map(rows.map((row) => [row.categoryId, row]));

    // A donor can never give away more than it actually has available.
    for (const [categoryId, donatedCents] of plan.donatedByCategory) {
      const row = rowById.get(categoryId);
      if (!row) return { ok: false, error: "A category in this fix no longer exists." };
      if (row.excludeFromOverspendCover) {
        return {
          ok: false,
          error: `${row.categoryName} is protected from funding overspending.`,
        };
      }
      if (donatedCents > row.availableCents) {
        return {
          ok: false,
          error: `${row.categoryName} only has ${(row.availableCents / 100).toFixed(2)} available.`,
        };
      }
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
    const pulledBackRows = [...pulledBack].map(([categoryId, cents]) => {
      const row = rowById.get(categoryId);
      return {
        user_id: user.id,
        budget_id: budget.id,
        category_id: categoryId,
        month,
        assigned_cents: (row?.assignedCents ?? 0) - cents,
        updated_at: new Date().toISOString(),
      };
    });
    if (pulledBackRows.length) {
      const { error } = await supabase.from("category_months").upsert(
        pulledBackRows,
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
  } finally {
    await supabase.rpc("release_overspend_fix_lock", {
      p_budget_id: budget.id,
      p_month: month,
      p_lock_token: lockToken,
    });
  }
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
  const returnTo = safeInternalPath(
    String(formData.get("return_to") ?? ""),
    `/accounts/${accountId || ""}`,
  );
  const errorPath =
    returnTo.startsWith("/transactions") ? "/transactions" : `/accounts/${accountId}`;

  if (!accountId) {
    redirect(returnTo.startsWith("/transactions") ? "/transactions" : "/accounts");
  }
  if (amount === null || amount === 0) {
    redirectWithError(errorPath, "Enter a valid non-zero amount.");
  }
  const amountValue = amount as number;
  if (!isValidIsoDate(occurredOn)) {
    redirectWithError(errorPath, "Invalid date.");
  }
  if (direction !== "inflow" && direction !== "outflow") {
    redirectWithError(errorPath, "Invalid direction.");
  }

  const account = await supabase
    .from("accounts")
    .select("id")
    .eq("budget_id", budget.id)
    .eq("id", accountId)
    .maybeSingle();
  if (!account.data?.id) {
    redirect(returnTo.startsWith("/transactions") ? "/transactions" : "/accounts");
  }

  let categoryId: string | null = categoryIdRaw || null;
  if (categoryId) {
    const category = await supabase
      .from("categories")
      .select("id")
      .eq("budget_id", budget.id)
      .eq("id", categoryId)
      .maybeSingle();
    if (!category.data?.id) {
      redirectWithError(errorPath, "Category not found.");
    }
  } else if (payee) {
    // Reuse the last / closest category you’ve assigned this payee to.
    categoryId = await suggestCategoryForPayee(supabase, budget.id, payee);
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
    redirectWithError(errorPath, "Could not save transaction.");
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
  revalidatePath("/transactions");
  const successPath = returnTo.startsWith("/transactions")
    ? "/transactions"
    : `/accounts/${accountId}`;
  redirect(
    `${successPath}?notice=${encodeURIComponent("Transaction Saved")}`,
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
  revalidatePath("/transactions");
  redirect(
    `/accounts/${accountId}?notice=${encodeURIComponent("Balance updated")}`,
  );
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
      .select("id,account_id,category_id,payee,memo,amount_cents,occurred_on")
      .eq("budget_id", budget.id)
      .eq("id", suggestion.manual_transaction_id)
      .maybeSingle(),
    supabase
      .from("transactions")
      .select("id,account_id,external_id,amount_cents,occurred_on,payee,cleared")
      .eq("budget_id", budget.id)
      .eq("id", suggestion.bank_transaction_id)
      .maybeSingle(),
  ]);

  if (
    !manualRes.data?.id ||
    !bankRes.data?.id ||
    manualRes.data.account_id !== suggestion.account_id ||
    bankRes.data.account_id !== suggestion.account_id ||
    !isBankExternalId(bankRes.data.external_id)
  ) {
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
  const returnTo = safeInternalPath(
    String(formData.get("return_to") ?? ""),
    "",
  );
  const fromTransactions = returnTo.startsWith("/transactions");

  const errorAccountId = fromAccountId || targetAccountId;
  const errorPath = fromTransactions
    ? "/transactions"
    : `/accounts/${errorAccountId}`;

  if (!transactionId || !fromAccountId || !targetAccountId) {
    redirect(fromTransactions ? "/transactions" : "/accounts");
  }
  if (amount === null || amount === 0) {
    redirectWithError(errorPath, "Enter a valid non-zero amount.");
  }
  const amountValue = amount as number;
  if (!isValidIsoDate(occurredOn)) {
    redirectWithError(errorPath, "Invalid date.");
  }
  if (direction !== "inflow" && direction !== "outflow") {
    redirectWithError(errorPath, "Invalid direction.");
  }

  const existing = await supabase
    .from("transactions")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("id", transactionId)
    .eq("account_id", fromAccountId)
    .maybeSingle();
  if (!existing.data?.id) {
    redirectWithError(errorPath, "Transaction not found.");
  }

  if (
    targetAccountId !== fromAccountId &&
    isBalanceAnchorExternalId(existing.data.external_id)
  ) {
    redirectWithError(
      errorPath,
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
      redirectWithError(errorPath, "Account not found.");
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
      redirectWithError(errorPath, "Category not found.");
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
    redirectWithError(errorPath, "Could not update transaction.");
  }

  await recordBudgetChange(supabase, {
    budgetId: budget.id,
    actorUserId: user.id,
    entityType: "transaction",
    entityId: transactionId,
    action: "update",
    summary: `Edited transaction “${payee || existing.data.payee || "Untitled"}”`,
    beforeSnapshot: { row: existing.data },
    afterSnapshot: {
      row: {
        ...existing.data,
        account_id: targetAccountId,
        category_id: categoryId,
        occurred_on: occurredOn,
        payee,
        memo,
        amount_cents: amountCents,
      },
    },
  });

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
  revalidatePath("/transactions");

  if (fromTransactions) {
    redirect("/transactions?notice=" + encodeURIComponent("Transaction updated"));
  }
  if (targetAccountId !== fromAccountId) {
    redirect(`/accounts/${targetAccountId}`);
  }
}

export async function setTransactionIgnoredAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const transactionId = String(formData.get("transaction_id") ?? "").trim();
  const accountId = String(formData.get("account_id") ?? "").trim();
  const ignoredRaw = String(formData.get("ignored") ?? "").trim();
  const ignored = ignoredRaw === "1" || ignoredRaw === "true";
  const returnTo = safeInternalPath(
    String(formData.get("return_to") ?? ""),
    "",
  );
  const fromTransactions = returnTo.startsWith("/transactions");
  const errorPath = fromTransactions
    ? "/transactions"
    : accountId
      ? `/accounts/${accountId}`
      : "/accounts";

  if (!transactionId || !accountId) {
    redirect(fromTransactions ? "/transactions" : "/accounts");
  }

  const { data: existing } = await supabase
    .from("transactions")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("id", transactionId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!existing?.id) {
    redirectWithError(errorPath, "Transaction not found.");
  }

  const { error } = await supabase
    .from("transactions")
    .update({ ignored })
    .eq("budget_id", budget.id)
    .eq("id", transactionId)
    .eq("account_id", accountId);
  if (error) {
    if (/ignored|schema cache|column/i.test(error.message)) {
      redirectWithError(
        errorPath,
        "Ignore is not available until the latest database migration is applied.",
      );
    }
    redirectWithError(errorPath, "Could not update transaction.");
  }

  await recordBudgetChange(supabase, {
    budgetId: budget.id,
    actorUserId: user.id,
    entityType: "transaction",
    entityId: transactionId,
    action: "update",
    summary: ignored
      ? `Ignored transaction “${existing.payee || "Untitled"}”`
      : `Unignored transaction “${existing.payee || "Untitled"}”`,
    beforeSnapshot: { row: existing },
    afterSnapshot: { row: { ...existing, ignored } },
  });

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/insights");

  if (fromTransactions) {
    redirect(
      "/transactions?notice=" +
        encodeURIComponent(ignored ? "Transaction ignored" : "Transaction restored"),
    );
  }
  redirect(
    `/accounts/${accountId}?notice=` +
      encodeURIComponent(ignored ? "Transaction ignored" : "Transaction restored"),
  );
}

export async function deleteTransactionAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const transactionId = String(formData.get("transaction_id") ?? "");
  const accountId = String(formData.get("account_id") ?? "");
  const returnTo = safeInternalPath(
    String(formData.get("return_to") ?? ""),
    "",
  );
  const fromTransactions = returnTo.startsWith("/transactions");
  const errorPath = fromTransactions
    ? "/transactions"
    : accountId
      ? `/accounts/${accountId}`
      : "/accounts";

  if (!transactionId || !accountId) {
    redirect(fromTransactions ? "/transactions" : "/accounts");
  }

  const { data: existing } = await supabase
    .from("transactions")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("id", transactionId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (existing) {
    await recordBudgetChange(supabase, {
      budgetId: budget.id,
      actorUserId: user.id,
      entityType: "transaction",
      entityId: transactionId,
      action: "delete",
      summary: `Deleted transaction “${existing.payee || "Untitled"}” (${existing.occurred_on})`,
      beforeSnapshot: { row: existing },
    });
  }

  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("budget_id", budget.id)
    .eq("id", transactionId)
    .eq("account_id", accountId);
  if (error) {
    redirectWithError(errorPath, "Could not delete transaction.");
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/budget");
  revalidatePath("/transactions");
  if (fromTransactions) {
    redirect("/transactions?notice=" + encodeURIComponent("Transaction deleted"));
  }
}

const BATCH_DELETE_LIMIT = 500;

export async function batchDeleteTransactionsAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const accountId = String(formData.get("account_id") ?? "").trim();
  const returnTo = safeInternalPath(
    String(formData.get("return_to") ?? ""),
    "",
  );
  const fromTransactions = returnTo.startsWith("/transactions");
  const ids = formData
    .getAll("transaction_ids")
    .map((value) => String(value).trim())
    .filter(Boolean);

  const errorPath = fromTransactions
    ? "/transactions"
    : accountId
      ? `/accounts/${accountId}`
      : "/accounts";

  if (!fromTransactions && !accountId) {
    redirect("/accounts");
  }
  if (ids.length === 0) {
    redirectWithError(errorPath, "Select at least one transaction.");
  }
  if (ids.length > BATCH_DELETE_LIMIT) {
    redirectWithError(
      errorPath,
      `You can delete at most ${BATCH_DELETE_LIMIT} transactions at once.`,
    );
  }

  let existingQuery = supabase
    .from("transactions")
    .select("*")
    .eq("budget_id", budget.id)
    .in("id", ids);
  if (accountId) {
    existingQuery = existingQuery.eq("account_id", accountId);
  }
  const { data: existingRows } = await existingQuery;

  if (existingRows?.length) {
    await recordBudgetChange(supabase, {
      budgetId: budget.id,
      actorUserId: user.id,
      entityType: "transaction",
      entityId: null,
      action: "delete",
      summary: `Deleted ${existingRows.length} transaction${existingRows.length === 1 ? "" : "s"}`,
      beforeSnapshot: { transactions: existingRows },
    });
  }

  let deleteQuery = supabase
    .from("transactions")
    .delete({ count: "exact" })
    .eq("budget_id", budget.id)
    .in("id", ids);
  if (accountId) {
    deleteQuery = deleteQuery.eq("account_id", accountId);
  }
  const { error, count } = await deleteQuery;

  if (error) {
    redirectWithError(errorPath, "Could not delete selected transactions.");
  }
  if (!count) {
    redirectWithError(errorPath, "No matching transactions to delete.");
  }

  if (accountId) revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/budget");
  revalidatePath("/transactions");
  if (fromTransactions) {
    redirect(
      "/transactions?notice=" +
        encodeURIComponent(`Deleted ${count} transaction${count === 1 ? "" : "s"}`),
    );
  }
}

export async function undoBudgetChangeAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("editor");
  const changeId = String(formData.get("change_id") ?? "").trim();
  if (!changeId) {
    redirectWithError("/settings", "Change not found.");
  }

  const { data, error } = await supabase
    .from("budget_change_log")
    .select(
      "id,budget_id,actor_user_id,entity_type,entity_id,action,summary,before_snapshot,after_snapshot,created_at,expires_at,restored_at",
    )
    .eq("budget_id", budget.id)
    .eq("id", changeId)
    .maybeSingle();

  if (error || !data) {
    redirectWithError(
      "/settings",
      /does not exist|schema cache|relation/i.test(error?.message ?? "")
        ? "Run the recent-changes migration in Supabase, then try again."
        : "Change not found or already expired.",
    );
  }

  try {
    await restoreBudgetChange(supabase, budget.id, data as BudgetChangeLogRow);
  } catch (err) {
    redirectWithError(
      "/settings",
      err instanceof Error ? err.message : "Could not undo that change.",
    );
  }

  revalidatePath("/budget");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/insights");
  revalidatePath("/settings");
  redirect(
    `/settings?notice=${encodeURIComponent("Change undone")}&changes=1`,
  );
}

export async function getRecentBudgetChangesAction(): Promise<BudgetChangeLogRow[]> {
  const { supabase, budget } = await requireBudget("viewer");
  return listRecentBudgetChanges(supabase, budget.id);
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
  revalidatePath("/transactions");
  revalidatePath("/settings");
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
  const membership = await supabase.from("budget_members").insert({
    budget_id: newBudgetId,
    user_id: user.id,
    role: "owner",
  });
  if (membership.error) {
    redirectWithError("/settings", "Could not create budget.");
  }
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
  const confirmDelete = String(formData.get("confirm_delete") ?? "").trim();
  if (confirmName !== budget.name) {
    redirectWithError("/settings", "Type the budget name exactly to delete it.");
  }
  if (confirmDelete !== "DELETE") {
    redirectWithError(
      "/settings",
      "Type DELETE in capitals to confirm permanent budget deletion.",
    );
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

const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Single-use role invite that expires in 30 days. Returns a complete URL. */
export async function generateRoleInviteAction(
  roleInput: string,
): Promise<
  | { ok: true; url: string; token: string; role: BudgetRole }
  | { ok: false; error: string }
> {
  const { supabase, user, budget, role: callerRole } =
    await requireBudget("admin");
  const role = roleInput as BudgetRole;
  if (!["owner", "admin", "editor", "viewer"].includes(role)) {
    return { ok: false, error: "Invalid role." };
  }
  if (role === "owner" && callerRole !== "owner") {
    return { ok: false, error: "Only an owner can invite another owner." };
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashInviteToken(token);
  const { error } = await supabase.from("budget_invites").insert({
    budget_id: budget.id,
    token_hash: tokenHash,
    kind: "role",
    role,
    created_by: user.id,
    expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    max_uses: 1,
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
  const { supabase, budget, role: callerRole } = await requireBudget("admin");
  const inviteId = String(formData.get("invite_id") ?? "");
  if (!inviteId) redirectWithError("/settings", "Invite required.");
  const { data: invite } = await supabase
    .from("budget_invites")
    .select("role")
    .eq("id", inviteId)
    .eq("budget_id", budget.id)
    .maybeSingle();
  if (!invite) redirectWithError("/settings", "Invite not found.");
  if (invite.role === "owner" && callerRole !== "owner") {
    redirectWithError("/settings", "Only an owner can revoke an owner invite.");
  }
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
  const { supabase, budget, role: callerRole } = await requireBudget("admin");
  const inviteId = String(formData.get("invite_id") ?? "").trim();
  if (!inviteId) redirectWithError("/settings", "Invite required.");

  const { data: invite, error: lookupError } = await supabase
    .from("budget_invites")
    .select("id,role,revoked_at")
    .eq("id", inviteId)
    .eq("budget_id", budget.id)
    .maybeSingle();

  if (lookupError || !invite) {
    redirectWithError("/settings", "Invite not found.");
  }
  if (invite.role === "owner" && callerRole !== "owner") {
    redirectWithError("/settings", "Only an owner can delete an owner invite.");
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
  // Server-side RPC hashes the raw token; clients never see or send token_hash.
  const { data, error } = await supabase.rpc("accept_budget_invite", {
    p_token: token,
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
  const { supabase, budget, role: callerRole } = await requireBudget("admin");
  const memberId = String(formData.get("member_id") ?? "");
  const role = String(formData.get("role") ?? "") as BudgetRole;
  if (!memberId || !["owner", "admin", "editor", "viewer"].includes(role)) {
    redirectWithError("/settings", "Invalid member update.");
  }
  const { data: target } = await supabase
    .from("budget_members")
    .select("id,role")
    .eq("id", memberId)
    .eq("budget_id", budget.id)
    .maybeSingle();
  if (!target) redirectWithError("/settings", "Member not found.");
  if (
    callerRole !== "owner" &&
    (target.role === "owner" || role === "owner")
  ) {
    redirectWithError(
      "/settings",
      "Only an owner can grant or change owner access.",
    );
  }
  if (target.role === "owner" && role !== "owner") {
    const { count } = await supabase
      .from("budget_members")
      .select("id", { count: "exact", head: true })
      .eq("budget_id", budget.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) {
      redirectWithError(
        "/settings",
        "Transfer ownership before changing the last owner.",
      );
    }
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
  const { supabase, user, budget, role: callerRole } =
    await requireBudget("admin");
  const memberUserId = String(formData.get("user_id") ?? "");
  if (!memberUserId) redirectWithError("/settings", "Member required.");
  if (memberUserId === user.id) {
    redirectWithError("/settings", "Use Leave budget to remove yourself.");
  }
  const { data: target } = await supabase
    .from("budget_members")
    .select("role")
    .eq("budget_id", budget.id)
    .eq("user_id", memberUserId)
    .maybeSingle();
  if (!target) redirectWithError("/settings", "Member not found.");
  if (target.role === "owner" && callerRole !== "owner") {
    redirectWithError("/settings", "Only an owner can remove another owner.");
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

function bankSyncConfigErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Bank sync failed.";
  if (/SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/i.test(message)) {
    return (
      "Bank sync isn’t fully configured: missing SUPABASE_SECRET_KEY in Doppler. " +
      "Add a Supabase secret key, redeploy, then try again."
    );
  }
  if (/BANK_TOKEN_ENCRYPTION_KEY/i.test(message)) {
    return (
      "Bank sync isn’t fully configured: missing BANK_TOKEN_ENCRYPTION_KEY in Doppler. " +
      "Add a dedicated encryption secret (don’t reuse CRON_SECRET), redeploy, then reconnect the bank."
    );
  }
  if (/PLAID_CLIENT_ID|PLAID_SECRET/i.test(message)) {
    return (
      "Bank sync isn’t fully configured: missing PLAID_CLIENT_ID or PLAID_SECRET in Doppler."
    );
  }
  if (/Invalid encrypted secret|auth tag|authenticate data|Unsupported state/i.test(message)) {
    return (
      "Could not decrypt the saved bank connection. The encryption key may have changed — " +
      "disconnect this bank in Settings and connect it again."
    );
  }
  return message.slice(0, 240);
}

export async function disconnectPlaidItemAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("admin");
  const itemId = String(formData.get("item_id") ?? "");
  if (!itemId) redirectWithError("/settings", "Bank connection required.");

  try {
    // Token ciphertext is not selectable via the user JWT; use service role after authz.
    const { createServiceClient } = await import("@/lib/supabase/admin");
    const admin = createServiceClient();
    const { data: item } = await admin
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
  } catch (error) {
    unstable_rethrow(error);
    redirectWithError("/settings", bankSyncConfigErrorMessage(error));
  }
}

export async function syncPlaidNowAction(formData: FormData) {
  const { budget } = await requireBudget("admin");
  const itemId = String(formData.get("item_id") ?? "");
  if (!itemId) redirectWithError("/settings", "Bank connection required.");

  try {
    const { createServiceClient } = await import("@/lib/supabase/admin");
    const admin = createServiceClient();
    const { data: item, error } = await admin
      .from("plaid_items")
      .select(
        "id,budget_id,access_token_encrypted,sync_cursor,created_by,status,institution_name",
      )
      .eq("id", itemId)
      .eq("budget_id", budget.id)
      .maybeSingle();

    if (error || !item || item.status === "disconnected") {
      redirectWithError("/settings", "Bank connection not found.");
    }

    const { manualSyncPlaidItem, formatManualSyncNotice } = await import(
      "@/lib/plaid/sync"
    );
    const started = new Date().toISOString();
    // Remap accounts + optional Plaid refresh + full sync. Do not disconnect.
    const result = await manualSyncPlaidItem(admin, item!);
    await admin.from("sync_runs").insert({
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
    revalidatePath("/transactions");
    revalidatePath("/budget");
    if (result.errors.length) {
      redirectWithError(
        "/settings",
        bankSyncConfigErrorMessage(new Error(result.errors[0] || "Sync finished with errors.")),
      );
    }
    redirect(
      `/settings?notice=${encodeURIComponent(formatManualSyncNotice(result))}`,
    );
  } catch (error) {
    unstable_rethrow(error);
    redirectWithError("/settings", bankSyncConfigErrorMessage(error));
  }
}

/**
 * Open-app / resume bank sync — same manual-style pull as Sync now, without
 * redirects, so the client can refresh the UI when it finishes.
 */
export async function syncPlaidOnOpenAction(): Promise<{
  skipped: boolean;
  reason?: string;
  runs?: number;
  inserted?: number;
  updated?: number;
  errors?: string[];
  notice?: string;
}> {
  const { budget } = await requireBudget("viewer");

  try {
    const { forceSyncPlaidForBudget } = await import("@/lib/plaid/catch-up");
    const result = await forceSyncPlaidForBudget(budget.id);

    if (!result.skipped) {
      revalidatePath("/budget");
      revalidatePath("/accounts");
      revalidatePath("/transactions");
      revalidatePath("/settings");
    }

    return result;
  } catch (error) {
    unstable_rethrow(error);
    const message = bankSyncConfigErrorMessage(error);
    return {
      skipped: true,
      reason: message,
      notice: message,
      errors: [message],
    };
  }
}


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
import { safeInternalPath } from "@/lib/paths";
import { absoluteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import type { BudgetRole } from "@/lib/types";
import {
  parseYnabCsv,
  ynabRowFingerprint,
  type ParsedYnabRow,
} from "@/lib/ynab-csv";
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

export async function updatePasswordAction(
  formData: FormData,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  await requireUser();
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

  const { error } = await supabase.from("accounts").insert({
    user_id: user.id,
    budget_id: budget.id,
    name,
    account_type: accountType,
  });
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

export async function createCategoryAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const groupName = String(formData.get("group_name") ?? "").trim() || "Everyday";
  const categoryName = String(formData.get("category_name") ?? "").trim();
  if (!categoryName) {
    redirectWithError("/budget", "Category name is required.");
  }

  let groupId: string | null = null;
  const existing = await supabase
    .from("category_groups")
    .select("id")
    .eq("budget_id", budget.id)
    .ilike("name", escapeIlikeExact(groupName))
    .maybeSingle();

  if (existing.data?.id) {
    groupId = existing.data.id;
  } else {
    const created = await supabase
      .from("category_groups")
      .insert({ user_id: user.id, budget_id: budget.id, name: groupName })
      .select("id")
      .single();
    if (created.error && isUniqueViolation(created.error)) {
      const again = await supabase
        .from("category_groups")
        .select("id")
        .eq("budget_id", budget.id)
        .ilike("name", escapeIlikeExact(groupName))
        .maybeSingle();
      groupId = again.data?.id ?? null;
    } else {
      const createdId = created.data?.id;
      if (created.error || !createdId) {
        redirectWithError("/budget", "Could not create category group.");
      }
      groupId = createdId;
    }
  }

  if (!groupId) {
    redirectWithError("/budget", "Could not create category group.");
  }

  const { error } = await supabase.from("categories").insert({
    user_id: user.id,
    budget_id: budget.id,
    group_id: groupId,
    name: categoryName,
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
  const { supabase, user, budget } = await requireBudget("editor");
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

export async function assignCategoryAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const categoryId = String(formData.get("category_id") ?? "");
  const month = String(formData.get("month") ?? currentBudgetMonth());
  const assigned = dollarsToCents(String(formData.get("assigned") ?? "0"));

  if (!categoryId || !isBudgetMonth(month)) {
    redirectWithError("/budget", "Invalid assignment.");
  }
  if (assigned === null) {
    redirectWithError("/budget", "Enter a valid dollar amount.");
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

  const monthUpsert = await supabase.from("budget_months").upsert(
    { user_id: user.id, budget_id: budget.id, month },
    { onConflict: "budget_id,month" },
  );
  if (monthUpsert.error) {
    redirectWithError("/budget", "Could not save budget month.");
  }

  const { error } = await supabase.from("category_months").upsert(
    {
      user_id: user.id,
      budget_id: budget.id,
      category_id: categoryId,
      month,
      assigned_cents: assigned,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "budget_id,category_id,month" },
  );
  if (error) {
    redirectWithError("/budget", "Could not save assignment.");
  }

  revalidatePath("/budget");
}

export async function setCategoryAssignPercentAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("editor");
  const categoryId = String(formData.get("category_id") ?? "");
  const raw = String(formData.get("assign_percent") ?? "").trim();
  const percent = Number(raw);
  if (!categoryId || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    redirectWithError("/budget", "Enter a percentage between 0 and 100.");
  }

  const { error } = await supabase
    .from("categories")
    .update({ assign_percent: Math.round(percent * 100) / 100 })
    .eq("budget_id", budget.id)
    .eq("id", categoryId);
  if (error) {
    redirectWithError(
      "/budget",
      /assign_percent/i.test(error.message)
        ? "Run the assign_percent migration in Supabase, then try again."
        : "Could not save percentage.",
    );
  }
  revalidatePath("/budget");
}

export async function autoAssignAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const month = String(formData.get("month") ?? currentBudgetMonth());
  if (!isBudgetMonth(month)) {
    redirectWithError("/budget", "Invalid month.");
  }

  const { readyToAssignCents, rows } = await getBudgetRows(month);
  const { assignments, totalAdded, error: distError } = distributeByPercent(
    readyToAssignCents,
    rows.map((row) => ({
      categoryId: row.categoryId,
      assignPercent: row.assignPercent,
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
  const { error } = await supabase
    .from("budget_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("budget_id", budget.id);
  if (error) redirectWithError("/settings", "Could not revoke invite.");
  revalidatePath("/settings");
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


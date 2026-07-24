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
import { requireBudget, setActiveBudgetId } from "@/lib/budget-context";
import { safeInternalPath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import type { BudgetRole } from "@/lib/types";
import {
  parseYnabCsv,
  ynabRowFingerprint,
  type ParsedYnabRow,
} from "@/lib/ynab-csv";

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

function redirectWithError(path: string, message: string, extra = "") {
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

  // Clear Teller mapping first (also cascades from account delete; explicit for clarity).
  await supabase
    .from("teller_accounts")
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

  const { error } = await supabase.from("transactions").insert({
    user_id: user.id,
    budget_id: budget.id,
    account_id: accountId,
    category_id: categoryId,
    occurred_on: occurredOn,
    payee,
    memo,
    amount_cents: amountCents,
    cleared: true,
  });
  if (error) {
    redirectWithError(`/accounts/${accountId}`, "Could not save transaction.");
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/budget");
}

export async function updateTransactionAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("editor");
  const transactionId = String(formData.get("transaction_id") ?? "");
  const accountId = String(formData.get("account_id") ?? "");
  const payee = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();
  const occurredOn = String(formData.get("occurred_on") ?? "");
  const categoryIdRaw = String(formData.get("category_id") ?? "");
  const amount = dollarsToCents(String(formData.get("amount") ?? ""));
  const direction = String(formData.get("direction") ?? "outflow");

  if (!transactionId || !accountId) {
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

  const existing = await supabase
    .from("transactions")
    .select("id")
    .eq("budget_id", budget.id)
    .eq("id", transactionId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!existing.data?.id) {
    redirectWithError(`/accounts/${accountId}`, "Transaction not found.");
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

  const { error } = await supabase
    .from("transactions")
    .update({
      category_id: categoryId,
      occurred_on: occurredOn,
      payee,
      memo,
      amount_cents: amountCents,
    })
    .eq("budget_id", budget.id)
    .eq("id", transactionId);
  if (error) {
    redirectWithError(`/accounts/${accountId}`, "Could not update transaction.");
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/budget");
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

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInviteLinkAction(formData: FormData) {
  const { supabase, user, budget } = await requireBudget("admin");
  const kind = String(formData.get("kind") ?? "shared");
  const role = String(formData.get("role") ?? "editor") as BudgetRole;
  if (kind !== "role" && kind !== "shared") {
    redirectWithError("/settings", "Invalid invite kind.");
  }
  if (kind === "role" && !["owner", "admin", "editor", "viewer"].includes(role)) {
    redirectWithError("/settings", "Invalid role.");
  }

  const token = createHash("sha256")
    .update(`${budget.id}:${user.id}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 48);
  const tokenHash = hashInviteToken(token);
  const { error } = await supabase.from("budget_invites").insert({
    budget_id: budget.id,
    token_hash: tokenHash,
    kind,
    role: kind === "role" ? role : null,
    created_by: user.id,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
    max_uses: kind === "shared" ? null : 10,
  });
  if (error) redirectWithError("/settings", "Could not create invite link.");

  redirect(`/settings?invite=${encodeURIComponent(token)}&kind=${encodeURIComponent(kind)}`);
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

export async function disconnectTellerEnrollmentAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("admin");
  const enrollmentId = String(formData.get("enrollment_id") ?? "");
  if (!enrollmentId) redirectWithError("/settings", "Enrollment required.");

  await supabase
    .from("teller_accounts")
    .delete()
    .eq("enrollment_id", enrollmentId)
    .eq("budget_id", budget.id);

  const { error } = await supabase
    .from("teller_enrollments")
    .update({
      status: "disconnected",
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", enrollmentId)
    .eq("budget_id", budget.id);

  if (error) redirectWithError("/settings", "Could not disconnect bank.");
  revalidatePath("/settings");
  revalidatePath("/accounts");
  redirect("/settings");
}

export async function syncTellerNowAction(formData: FormData) {
  const { supabase, budget } = await requireBudget("admin");
  const enrollmentId = String(formData.get("enrollment_id") ?? "");
  if (!enrollmentId) redirectWithError("/settings", "Enrollment required.");

  const { data: enrollment, error } = await supabase
    .from("teller_enrollments")
    .select("id,budget_id,access_token_encrypted,last_synced_at,created_by,status")
    .eq("id", enrollmentId)
    .eq("budget_id", budget.id)
    .maybeSingle();

  if (error || !enrollment || enrollment.status === "disconnected") {
    redirectWithError("/settings", "Enrollment not found.");
  }

  const { syncEnrollment } = await import("@/lib/teller/sync");
  const started = new Date().toISOString();
  const result = await syncEnrollment(supabase, enrollment!);
  await supabase.from("sync_runs").insert({
    budget_id: budget.id,
    enrollment_id: enrollment!.id,
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


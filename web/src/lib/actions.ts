"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  currentBudgetMonth,
  dollarsToCents,
  isBudgetMonth,
} from "@/lib/money";
import { safeInternalPath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import { parseYnabRegisterCsv } from "@/lib/ynab-csv";

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
  redirect("/budget");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createAccountAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const accountType = String(formData.get("account_type") ?? "checking");
  if (!name) return;
  if (!ACCOUNT_TYPES.has(accountType)) {
    redirectWithError("/accounts", "Invalid account type.");
  }

  const { error } = await supabase.from("accounts").insert({
    user_id: user.id,
    name,
    account_type: accountType,
  });
  if (error) {
    redirectWithError("/accounts", "Could not create account.");
  }
  revalidatePath("/accounts");
  revalidatePath("/budget");
}

export async function createCategoryAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  const groupName = String(formData.get("group_name") ?? "").trim() || "Everyday";
  const categoryName = String(formData.get("category_name") ?? "").trim();
  if (!categoryName) return;

  let groupId: string | null = null;
  const existing = await supabase
    .from("category_groups")
    .select("id")
    .eq("user_id", user.id)
    .eq("name", groupName)
    .maybeSingle();

  if (existing.data?.id) {
    groupId = existing.data.id;
  } else {
    const created = await supabase
      .from("category_groups")
      .insert({ user_id: user.id, name: groupName })
      .select("id")
      .single();
    const createdId = created.data?.id;
    if (created.error || !createdId) {
      redirectWithError("/budget", "Could not create category group.");
    }
    groupId = createdId;
  }

  const { error } = await supabase.from("categories").insert({
    user_id: user.id,
    group_id: groupId,
    name: categoryName,
  });
  if (error) {
    redirectWithError("/budget", "Could not create category.");
  }

  revalidatePath("/budget");
}

export async function assignCategoryAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  const categoryId = String(formData.get("category_id") ?? "");
  const month = String(formData.get("month") ?? currentBudgetMonth());
  const assigned = dollarsToCents(String(formData.get("assigned") ?? "0"));

  if (!categoryId || !isBudgetMonth(month)) return;

  const owned = await supabase
    .from("categories")
    .select("id")
    .eq("user_id", user.id)
    .eq("id", categoryId)
    .maybeSingle();
  if (!owned.data?.id) {
    redirectWithError("/budget", "Category not found.");
  }

  const monthUpsert = await supabase.from("budget_months").upsert(
    { user_id: user.id, month },
    { onConflict: "user_id,month" },
  );
  if (monthUpsert.error) {
    redirectWithError("/budget", "Could not save budget month.");
  }

  const { error } = await supabase.from("category_months").upsert(
    {
      user_id: user.id,
      category_id: categoryId,
      month,
      assigned_cents: assigned,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,category_id,month" },
  );
  if (error) {
    redirectWithError("/budget", "Could not save assignment.");
  }

  revalidatePath("/budget");
}

export async function createTransactionAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  const accountId = String(formData.get("account_id") ?? "");
  const payee = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();
  const occurredOn = String(formData.get("occurred_on") ?? "");
  const categoryIdRaw = String(formData.get("category_id") ?? "");
  const amount = dollarsToCents(String(formData.get("amount") ?? "0"));
  const direction = String(formData.get("direction") ?? "outflow");

  if (!accountId || !occurredOn || amount === 0) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
    redirectWithError(`/accounts/${accountId}`, "Invalid date.");
  }

  const account = await supabase
    .from("accounts")
    .select("id")
    .eq("user_id", user.id)
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
      .eq("user_id", user.id)
      .eq("id", categoryId)
      .maybeSingle();
    if (!category.data?.id) {
      redirectWithError(`/accounts/${accountId}`, "Category not found.");
    }
  }

  const amountCents = direction === "inflow" ? Math.abs(amount) : -Math.abs(amount);

  const { error } = await supabase.from("transactions").insert({
    user_id: user.id,
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

  const { supabase, user } = await requireUser();
  const contentHash = createHash("sha256")
    .update(parsedInput.data.csvText)
    .digest("hex");

  const priorImport = await supabase
    .from("import_batches")
    .select("id,inserted_count")
    .eq("user_id", user.id)
    .eq("content_hash", contentHash)
    .maybeSingle();

  if (priorImport.data?.id) {
    return {
      ok: false,
      inserted: 0,
      skipped: priorImport.data.inserted_count ?? 0,
      errors: [],
      message: "This file was already imported. Upload a new export to add more transactions.",
    };
  }

  const { rows, skipped, errors } = parseYnabRegisterCsv(parsedInput.data.csvText);

  if (rows.length === 0) {
    return {
      ok: false,
      inserted: 0,
      skipped,
      errors,
      message: "No importable transactions found. Use a YNAB register CSV export.",
    };
  }

  const batch = await supabase
    .from("import_batches")
    .insert({
      user_id: user.id,
      filename: parsedInput.data.filename,
      source: "ynab_csv",
      content_hash: contentHash,
      inserted_count: 0,
      skipped_count: skipped,
      error_count: errors.length,
    })
    .select("id")
    .single();

  if (batch.error || !batch.data?.id) {
    const duplicate =
      batch.error?.code === "23505" ||
      /duplicate|unique/i.test(batch.error?.message ?? "");
    return {
      ok: false,
      inserted: 0,
      skipped,
      errors: duplicate
        ? []
        : [batch.error?.message ?? "Could not create import batch"],
      message: duplicate
        ? "This file was already imported. Upload a new export to add more transactions."
        : "Import failed before inserting rows.",
    };
  }

  const batchId = batch.data.id;

  const accountIds = new Map<string, string>();
  const groupIds = new Map<string, string>();
  const categoryIds = new Map<string, string>();

  const [{ data: existingAccounts }, { data: existingGroups }, { data: existingCategories }] =
    await Promise.all([
      supabase.from("accounts").select("id,name").eq("user_id", user.id),
      supabase.from("category_groups").select("id,name").eq("user_id", user.id),
      supabase.from("categories").select("id,name,group_id").eq("user_id", user.id),
    ]);

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
      .insert({ user_id: user.id, name, account_type: "checking" })
      .select("id")
      .single();
    if (!created.data?.id) {
      throw new Error(created.error?.message ?? `Failed to create account ${name}`);
    }
    accountIds.set(key, created.data.id);
    return created.data.id;
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
        .insert({ user_id: user.id, name: resolvedGroup })
        .select("id")
        .single();
      groupId = createdGroup.data?.id;
      if (!groupId) {
        throw new Error(createdGroup.error?.message ?? "Failed to create category group");
      }
      groupIds.set(resolvedGroup.toLowerCase(), groupId);
    }

    const createdCategory = await supabase
      .from("categories")
      .insert({
        user_id: user.id,
        group_id: groupId,
        name: categoryName,
      })
      .select("id")
      .single();

    if (!createdCategory.data?.id) {
      throw new Error(createdCategory.error?.message ?? "Failed to create category");
    }
    categoryIds.set(mapKey, createdCategory.data.id);
    return createdCategory.data.id;
  }

  const payload = [];
  let localSkipped = skipped;
  const localErrors = [...errors];

  for (const row of rows) {
    try {
      const accountId = await ensureAccount(row.accountName);
      const categoryId = await ensureCategory(row.categoryGroup, row.categoryName);
      payload.push({
        user_id: user.id,
        account_id: accountId,
        category_id: categoryId,
        occurred_on: row.occurredOn,
        payee: row.payee,
        memo: row.memo,
        amount_cents: row.amountCents,
        cleared: true,
        import_batch_id: batchId,
      });
    } catch (error) {
      localSkipped += 1;
      localErrors.push(error instanceof Error ? error.message : "Row failed");
    }
  }

  let inserted = 0;
  const chunkSize = 200;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error, data } = await supabase.from("transactions").insert(chunk).select("id");
    if (error) {
      localErrors.push(error.message);
      localSkipped += chunk.length;
    } else {
      inserted += data?.length ?? chunk.length;
    }
  }

  await supabase
    .from("import_batches")
    .update({
      inserted_count: inserted,
      skipped_count: localSkipped,
      error_count: localErrors.length,
    })
    .eq("id", batchId)
    .eq("user_id", user.id);

  revalidatePath("/budget");
  revalidatePath("/accounts");
  revalidatePath("/import");

  return {
    ok: inserted > 0,
    inserted,
    skipped: localSkipped,
    errors: localErrors.slice(0, 25),
    message:
      inserted > 0
        ? `Imported ${inserted} transactions.`
        : "Import finished without inserting rows.",
  };
}

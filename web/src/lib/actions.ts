"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentBudgetMonth, dollarsToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { parseYnabRegisterCsv } from "@/lib/ynab-csv";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/budget");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect(next.startsWith("/") ? next : "/budget");
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
    redirect(`/login?error=${encodeURIComponent(error.message)}&mode=signup`);
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

  await supabase.from("accounts").insert({
    user_id: user.id,
    name,
    account_type: accountType,
  });
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
    groupId = created.data?.id ?? null;
  }

  if (!groupId) return;

  await supabase.from("categories").insert({
    user_id: user.id,
    group_id: groupId,
    name: categoryName,
  });

  revalidatePath("/budget");
}

export async function assignCategoryAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  const categoryId = String(formData.get("category_id") ?? "");
  const month = String(formData.get("month") ?? currentBudgetMonth());
  const assigned = dollarsToCents(String(formData.get("assigned") ?? "0"));

  if (!categoryId) return;

  await supabase.from("budget_months").upsert(
    { user_id: user.id, month },
    { onConflict: "user_id,month" },
  );

  await supabase.from("category_months").upsert(
    {
      user_id: user.id,
      category_id: categoryId,
      month,
      assigned_cents: assigned,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,category_id,month" },
  );

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

  const amountCents = direction === "inflow" ? Math.abs(amount) : -Math.abs(amount);

  await supabase.from("transactions").insert({
    user_id: user.id,
    account_id: accountId,
    category_id: categoryIdRaw || null,
    occurred_on: occurredOn,
    payee,
    memo,
    amount_cents: amountCents,
    cleared: true,
  });

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
      inserted_count: 0,
      skipped_count: skipped,
      error_count: errors.length,
    })
    .select("id")
    .single();

  const batchId = batch.data?.id ?? null;

  const accountIds = new Map<string, string>();
  const groupIds = new Map<string, string>();
  const categoryIds = new Map<string, string>();

  async function ensureAccount(name: string) {
    const key = name.toLowerCase();
    if (accountIds.has(key)) return accountIds.get(key)!;
    const existing = await supabase
      .from("accounts")
      .select("id")
      .eq("user_id", user.id)
      .ilike("name", name)
      .maybeSingle();
    if (existing.data?.id) {
      accountIds.set(key, existing.data.id);
      return existing.data.id;
    }
    const created = await supabase
      .from("accounts")
      .insert({ user_id: user.id, name, account_type: "checking" })
      .select("id")
      .single();
    if (!created.data?.id) throw new Error(`Failed to create account ${name}`);
    accountIds.set(key, created.data.id);
    return created.data.id;
  }

  async function ensureCategory(groupName: string, categoryName: string) {
    if (!categoryName) return null;
    const mapKey = `${groupName.toLowerCase()}::${categoryName.toLowerCase()}`;
    if (categoryIds.has(mapKey)) return categoryIds.get(mapKey)!;

    let groupId = groupIds.get(groupName.toLowerCase());
    if (!groupId) {
      const existingGroup = await supabase
        .from("category_groups")
        .select("id")
        .eq("user_id", user.id)
        .ilike("name", groupName || "Imported")
        .maybeSingle();
      if (existingGroup.data?.id) {
        groupId = existingGroup.data.id;
      } else {
        const createdGroup = await supabase
          .from("category_groups")
          .insert({ user_id: user.id, name: groupName || "Imported" })
          .select("id")
          .single();
        groupId = createdGroup.data?.id;
      }
      if (!groupId) throw new Error("Failed to create category group");
      groupIds.set((groupName || "Imported").toLowerCase(), groupId);
    }

    const existingCategory = await supabase
      .from("categories")
      .select("id")
      .eq("user_id", user.id)
      .eq("group_id", groupId)
      .ilike("name", categoryName)
      .maybeSingle();

    if (existingCategory.data?.id) {
      categoryIds.set(mapKey, existingCategory.data.id);
      return existingCategory.data.id;
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

    if (!createdCategory.data?.id) throw new Error("Failed to create category");
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

  if (batchId) {
    await supabase
      .from("import_batches")
      .update({
        inserted_count: inserted,
        skipped_count: localSkipped,
        error_count: localErrors.length,
      })
      .eq("id", batchId);
  }

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

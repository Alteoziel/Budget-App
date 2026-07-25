import type { SupabaseClient } from "@supabase/supabase-js";

export type ChangeEntityType =
  | "transaction"
  | "account"
  | "category"
  | "category_group"
  | "assignment";

export type ChangeAction = "delete" | "update";

export type BudgetChangeLogRow = {
  id: string;
  budget_id: string;
  actor_user_id: string;
  entity_type: ChangeEntityType;
  entity_id: string | null;
  action: ChangeAction;
  summary: string;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown> | null;
  created_at: string;
  expires_at: string;
  restored_at: string | null;
};

type AnyClient = SupabaseClient;

function missingTable(error: { message?: string } | null | undefined) {
  return /does not exist|schema cache|relation/i.test(error?.message ?? "");
}

export async function purgeExpiredChangeLog(
  supabase: AnyClient,
  budgetId: string,
) {
  const { error } = await supabase.rpc("purge_expired_budget_change_log", {
    p_budget_id: budgetId,
  });
  if (error && !missingTable(error)) {
    // Best-effort cleanup; listing still filters by expires_at.
  }
}

export async function recordBudgetChange(
  supabase: AnyClient,
  input: {
    budgetId: string;
    actorUserId: string;
    entityType: ChangeEntityType;
    entityId?: string | null;
    action: ChangeAction;
    summary: string;
    beforeSnapshot: Record<string, unknown>;
    afterSnapshot?: Record<string, unknown> | null;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("budget_change_log")
    .insert({
      budget_id: input.budgetId,
      actor_user_id: input.actorUserId,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      action: input.action,
      summary: input.summary,
      before_snapshot: input.beforeSnapshot,
      after_snapshot: input.afterSnapshot ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (missingTable(error)) return null;
    console.error("Failed to record budget change", error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function listRecentBudgetChanges(
  supabase: AnyClient,
  budgetId: string,
): Promise<BudgetChangeLogRow[]> {
  await purgeExpiredChangeLog(supabase, budgetId);

  const { data, error } = await supabase
    .from("budget_change_log")
    .select(
      "id,budget_id,actor_user_id,entity_type,entity_id,action,summary,before_snapshot,after_snapshot,created_at,expires_at,restored_at",
    )
    .eq("budget_id", budgetId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as BudgetChangeLogRow[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row) => row && typeof row === "object") as Record<
        string,
        unknown
      >[]
    : [];
}

async function restoreTransactionRow(
  supabase: AnyClient,
  budgetId: string,
  row: Record<string, unknown>,
) {
  const payload = {
    id: row.id,
    user_id: row.user_id,
    budget_id: budgetId,
    account_id: row.account_id,
    category_id: row.category_id ?? null,
    occurred_on: row.occurred_on,
    payee: row.payee ?? "",
    memo: row.memo ?? "",
    amount_cents: row.amount_cents,
    cleared: row.cleared ?? true,
    external_id: row.external_id ?? null,
    import_batch_id: row.import_batch_id ?? null,
    import_fingerprint: row.import_fingerprint ?? null,
  };

  const { error } = await supabase.from("transactions").upsert(payload, {
    onConflict: "id",
  });
  if (error) {
    // Retry without optional columns that may not exist in older DBs.
    const { error: retryError } = await supabase.from("transactions").upsert(
      {
        id: payload.id,
        user_id: payload.user_id,
        budget_id: payload.budget_id,
        account_id: payload.account_id,
        category_id: payload.category_id,
        occurred_on: payload.occurred_on,
        payee: payload.payee,
        memo: payload.memo,
        amount_cents: payload.amount_cents,
        cleared: payload.cleared,
      },
      { onConflict: "id" },
    );
    if (retryError) throw new Error(retryError.message);
  }
}

async function restoreAccountDelete(
  supabase: AnyClient,
  budgetId: string,
  snapshot: Record<string, unknown>,
) {
  const account = asRecord(snapshot.account);
  if (!account?.id) throw new Error("Account snapshot missing.");

  const accountPayload = {
    id: account.id,
    user_id: account.user_id,
    budget_id: budgetId,
    name: account.name,
    account_type: account.account_type ?? "checking",
    currency: account.currency ?? "USD",
    notes: account.notes ?? null,
    include_in_total: account.include_in_total ?? true,
    sort_order: account.sort_order ?? 0,
  };

  let { error } = await supabase.from("accounts").upsert(accountPayload, {
    onConflict: "id",
  });
  if (error && /include_in_total|sort_order|notes|schema cache|column/i.test(error.message)) {
    ({ error } = await supabase.from("accounts").upsert(
      {
        id: accountPayload.id,
        user_id: accountPayload.user_id,
        budget_id: accountPayload.budget_id,
        name: accountPayload.name,
        account_type: accountPayload.account_type,
        currency: accountPayload.currency,
      },
      { onConflict: "id" },
    ));
  }
  if (error) throw new Error(error.message);

  for (const txn of asArray(snapshot.transactions)) {
    await restoreTransactionRow(supabase, budgetId, txn);
  }
}

async function restoreCategoryMonths(
  supabase: AnyClient,
  budgetId: string,
  months: Record<string, unknown>[],
) {
  for (const month of months) {
    const payload = {
      id: month.id,
      user_id: month.user_id,
      budget_id: budgetId,
      category_id: month.category_id,
      month: month.month,
      assigned_cents: month.assigned_cents ?? 0,
    };
    const { error } = await supabase.from("category_months").upsert(payload, {
      onConflict: "id",
    });
    if (error) {
      const { error: retryError } = await supabase.from("category_months").upsert(
        {
          user_id: payload.user_id,
          budget_id: payload.budget_id,
          category_id: payload.category_id,
          month: payload.month,
          assigned_cents: payload.assigned_cents,
        },
        { onConflict: "budget_id,category_id,month" },
      );
      if (retryError && !/onConflict|conflict|schema/i.test(retryError.message)) {
        // Unique constraint name may differ; last resort insert ignore duplicates.
        await supabase.from("category_months").insert({
          user_id: payload.user_id,
          budget_id: payload.budget_id,
          category_id: payload.category_id,
          month: payload.month,
          assigned_cents: payload.assigned_cents,
        });
      }
    }
  }
}

async function restoreCategoryDelete(
  supabase: AnyClient,
  budgetId: string,
  snapshot: Record<string, unknown>,
) {
  const category = asRecord(snapshot.category);
  if (!category?.id) throw new Error("Category snapshot missing.");

  const payload = {
    id: category.id,
    user_id: category.user_id,
    budget_id: budgetId,
    group_id: category.group_id,
    name: category.name,
    sort_order: category.sort_order ?? 0,
    hidden: category.hidden ?? false,
    assign_percent: category.assign_percent ?? 0,
    assign_mode: category.assign_mode ?? "percent",
    assign_fixed_cents: category.assign_fixed_cents ?? 0,
    goal_cents: category.goal_cents ?? null,
    goal_name: category.goal_name ?? "",
    goal_frequency: category.goal_frequency ?? "monthly",
    goal_note: category.goal_note ?? "",
    goal_due_on: category.goal_due_on ?? null,
  };

  let { error } = await supabase.from("categories").upsert(payload, {
    onConflict: "id",
  });
  if (error && /assign_|goal_|schema cache|column/i.test(error.message)) {
    ({ error } = await supabase.from("categories").upsert(
      {
        id: payload.id,
        user_id: payload.user_id,
        budget_id: payload.budget_id,
        group_id: payload.group_id,
        name: payload.name,
        sort_order: payload.sort_order,
        hidden: payload.hidden,
      },
      { onConflict: "id" },
    ));
  }
  if (error) throw new Error(error.message);

  await restoreCategoryMonths(supabase, budgetId, asArray(snapshot.category_months));

  const linkedIds = Array.isArray(snapshot.linked_transaction_ids)
    ? snapshot.linked_transaction_ids.map(String).filter(Boolean)
    : [];
  if (linkedIds.length) {
    await supabase
      .from("transactions")
      .update({ category_id: category.id })
      .eq("budget_id", budgetId)
      .in("id", linkedIds);
  }
}

async function restoreAssignmentUpdate(
  supabase: AnyClient,
  budgetId: string,
  before: Record<string, unknown>,
  afterSnapshot: Record<string, unknown> | null,
) {
  const month = String(before.month ?? "");
  if (!month) throw new Error("Assignment month missing.");

  const beforeRows = asArray(before.category_months);
  const afterRows = asArray(afterSnapshot?.category_months);
  const beforeByCategory = new Map(
    beforeRows.map((row) => [String(row.category_id), row]),
  );
  const touchedIds = new Set<string>([
    ...beforeRows.map((row) => String(row.category_id)),
    ...afterRows.map((row) => String(row.category_id)),
    ...(Array.isArray(before.touched_category_ids)
      ? before.touched_category_ids.map(String)
      : []),
  ]);

  for (const categoryId of touchedIds) {
    const beforeRow = beforeByCategory.get(categoryId);
    const assignedCents = beforeRow
      ? Number(beforeRow.assigned_cents ?? 0)
      : 0;
    const userId = String(
      beforeRow?.user_id ?? afterRows.find((row) => String(row.category_id) === categoryId)?.user_id ?? "",
    );

    if (!userId) {
      // No ownership context — best effort update of existing row only.
      const { error } = await supabase
        .from("category_months")
        .update({ assigned_cents: assignedCents })
        .eq("budget_id", budgetId)
        .eq("category_id", categoryId)
        .eq("month", month);
      if (error) throw new Error(error.message);
      continue;
    }

    const { error } = await supabase.from("category_months").upsert(
      {
        user_id: userId,
        budget_id: budgetId,
        category_id: categoryId,
        month,
        assigned_cents: assignedCents,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "budget_id,category_id,month" },
    );
    if (error) throw new Error(error.message);
  }
}

async function restoreCategoryGroupDelete(
  supabase: AnyClient,
  budgetId: string,
  snapshot: Record<string, unknown>,
) {
  const group = asRecord(snapshot.group);
  if (!group?.id) throw new Error("Group snapshot missing.");

  const { error } = await supabase.from("category_groups").upsert(
    {
      id: group.id,
      user_id: group.user_id,
      budget_id: budgetId,
      name: group.name,
      sort_order: group.sort_order ?? 0,
      hidden: group.hidden ?? false,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);

  const byCategory = asRecord(snapshot.linked_transaction_ids_by_category) ?? {};

  for (const category of asArray(snapshot.categories)) {
    const linked = byCategory[String(category.id)];
    const linkedIds = Array.isArray(linked)
      ? linked.map(String).filter(Boolean)
      : [];
    await restoreCategoryDelete(supabase, budgetId, {
      category,
      category_months: asArray(snapshot.category_months).filter(
        (month) => String(month.category_id) === String(category.id),
      ),
      linked_transaction_ids: linkedIds,
    });
  }
}

export async function restoreBudgetChange(
  supabase: AnyClient,
  budgetId: string,
  entry: BudgetChangeLogRow,
): Promise<void> {
  if (entry.restored_at) {
    throw new Error("This change was already undone.");
  }
  if (new Date(entry.expires_at).getTime() < Date.now()) {
    throw new Error("This change is older than 7 days and can no longer be undone.");
  }

  const before = entry.before_snapshot ?? {};

  if (entry.action === "update") {
    if (entry.entity_type === "transaction") {
      const row = asRecord(before.row) ?? before;
      if (!row.id) throw new Error("Transaction snapshot missing.");
      const { error } = await supabase
        .from("transactions")
        .update({
          account_id: row.account_id,
          category_id: row.category_id ?? null,
          occurred_on: row.occurred_on,
          payee: row.payee ?? "",
          memo: row.memo ?? "",
          amount_cents: row.amount_cents,
        })
        .eq("budget_id", budgetId)
        .eq("id", String(row.id));
      if (error) throw new Error(error.message);
    } else if (entry.entity_type === "category") {
      const row = asRecord(before.category) ?? before;
      if (!row.id) throw new Error("Category snapshot missing.");
      const { error } = await supabase
        .from("categories")
        .update({
          name: row.name,
          group_id: row.group_id,
          sort_order: row.sort_order,
          hidden: row.hidden,
          assign_percent: row.assign_percent,
          assign_mode: row.assign_mode,
          assign_fixed_cents: row.assign_fixed_cents,
          goal_cents: row.goal_cents,
          goal_name: row.goal_name,
          goal_frequency: row.goal_frequency,
          goal_note: row.goal_note,
          goal_due_on: row.goal_due_on ?? null,
        })
        .eq("budget_id", budgetId)
        .eq("id", String(row.id));
      if (error) throw new Error(error.message);
    } else if (entry.entity_type === "category_group") {
      const row = asRecord(before.group) ?? before;
      if (!row.id) throw new Error("Group snapshot missing.");
      const { error } = await supabase
        .from("category_groups")
        .update({
          name: row.name,
          sort_order: row.sort_order,
          hidden: row.hidden,
        })
        .eq("budget_id", budgetId)
        .eq("id", String(row.id));
      if (error) throw new Error(error.message);
    } else if (entry.entity_type === "account") {
      const row = asRecord(before.account) ?? before;
      if (!row.id) throw new Error("Account snapshot missing.");
      const { error } = await supabase
        .from("accounts")
        .update({
          name: row.name,
          account_type: row.account_type,
          include_in_total: row.include_in_total,
          sort_order: row.sort_order,
        })
        .eq("budget_id", budgetId)
        .eq("id", String(row.id));
      if (error) throw new Error(error.message);
    } else if (entry.entity_type === "assignment") {
      await restoreAssignmentUpdate(supabase, budgetId, before, entry.after_snapshot);
    } else {
      throw new Error("Unsupported change type.");
    }
  } else if (entry.action === "delete") {
    if (entry.entity_type === "transaction") {
      const rows = asArray(before.transactions);
      const single = asRecord(before.row);
      const list = rows.length ? rows : single ? [single] : [];
      if (!list.length) throw new Error("Transaction snapshot missing.");
      for (const row of list) {
        await restoreTransactionRow(supabase, budgetId, row);
      }
    } else if (entry.entity_type === "account") {
      await restoreAccountDelete(supabase, budgetId, before);
    } else if (entry.entity_type === "category") {
      await restoreCategoryDelete(supabase, budgetId, before);
    } else if (entry.entity_type === "category_group") {
      await restoreCategoryGroupDelete(supabase, budgetId, before);
    } else {
      throw new Error("Unsupported change type.");
    }
  }

  const { error: markError } = await supabase
    .from("budget_change_log")
    .update({ restored_at: new Date().toISOString() })
    .eq("budget_id", budgetId)
    .eq("id", entry.id);
  if (markError && !missingTable(markError)) {
    throw new Error(markError.message);
  }
}

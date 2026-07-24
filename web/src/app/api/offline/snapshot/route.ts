import { NextResponse } from "next/server";
import {
  resolveActiveBudget,
  roleAtLeast,
} from "@/lib/budget-context";
import { getAccountsWithBalances, getBudgetRows } from "@/lib/budget-data";
import { currentBudgetMonth } from "@/lib/money";
import type { OfflineSnapshot } from "@/lib/offline/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Compact JSON snapshot used for offline browsing on the device. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const active = await resolveActiveBudget();
  if (!active || !roleAtLeast(active.role, "viewer")) {
    return NextResponse.json({ error: "No budget available." }, { status: 403 });
  }

  try {
    const month = currentBudgetMonth();
    const [{ rows, readyToAssignCents }, accounts] = await Promise.all([
      getBudgetRows(month),
      getAccountsWithBalances(),
    ]);

    const accountIds = accounts.map((a) => a.id);
    const { data: txns, error } = accountIds.length
      ? await supabase
          .from("transactions")
          .select("id,account_id,category_id,occurred_on,payee,memo,amount_cents")
          .eq("budget_id", active.budget.id)
          .in("account_id", accountIds)
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(200)
      : { data: [], error: null };

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    const categoryName = new Map(rows.map((r) => [r.categoryId, r.categoryName]));

    const snapshot: OfflineSnapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      budget: { id: active.budget.id, name: active.budget.name },
      readyToAssignCents,
      month,
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        account_type: account.account_type,
        balanceCents: account.balanceCents,
      })),
      categories: rows.map((row) => ({
        id: row.categoryId,
        name: row.categoryName,
        groupName: row.groupName,
        availableCents: row.availableCents,
        assignedCents: row.assignedCents,
        activityCents: row.activityCents,
      })),
      recentTransactions: (txns ?? []).map((txn) => ({
        id: txn.id as string,
        account_id: txn.account_id as string,
        accountName: accountName.get(txn.account_id as string) ?? "Account",
        category_id: (txn.category_id as string | null) ?? null,
        categoryName: txn.category_id
          ? (categoryName.get(txn.category_id as string) ?? "Category")
          : null,
        occurred_on: txn.occurred_on as string,
        payee: (txn.payee as string) ?? "",
        memo: (txn.memo as string) ?? "",
        amount_cents: txn.amount_cents as number,
      })),
    };

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Snapshot failed" },
      { status: 500 },
    );
  }
}

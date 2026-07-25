import { NextResponse } from "next/server";
import { z } from "zod";
import {
  resolveActiveBudget,
  roleAtLeast,
} from "@/lib/budget-context";
import { dollarsToCents, isValidIsoDate } from "@/lib/money";
import { suggestCategoryForPayee } from "@/lib/payee-categorization";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const itemSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("create_transaction"),
  payload: z.object({
    account_id: z.string().uuid(),
    category_id: z.string().uuid().or(z.literal("")).default(""),
    occurred_on: z.string(),
    payee: z.string().max(200).default(""),
    memo: z.string().max(500).default(""),
    amount: z.string(),
    direction: z.enum(["inflow", "outflow"]),
  }),
});

const bodySchema = z.object({
  items: z.array(itemSchema).max(50),
});

/** Replay offline-queued writes once the device is back online. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const active = await resolveActiveBudget();
  if (!active || !roleAtLeast(active.role, "editor")) {
    return NextResponse.json({ error: "Editor access required." }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sync payload." }, { status: 400 });
  }

  const applied: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const item of parsed.data.items) {
    try {
      const amount = dollarsToCents(item.payload.amount);
      if (amount === null || amount === 0) {
        failed.push({ id: item.id, error: "Invalid amount." });
        continue;
      }
      if (!isValidIsoDate(item.payload.occurred_on)) {
        failed.push({ id: item.id, error: "Invalid date." });
        continue;
      }

      const account = await supabase
        .from("accounts")
        .select("id")
        .eq("budget_id", active.budget.id)
        .eq("id", item.payload.account_id)
        .maybeSingle();
      if (!account.data?.id) {
        failed.push({ id: item.id, error: "Account not found." });
        continue;
      }

      let categoryId: string | null = item.payload.category_id || null;
      if (categoryId) {
        const category = await supabase
          .from("categories")
          .select("id")
          .eq("budget_id", active.budget.id)
          .eq("id", categoryId)
          .maybeSingle();
        if (!category.data?.id) {
          failed.push({ id: item.id, error: "Category not found." });
          continue;
        }
      } else if (item.payload.payee.trim()) {
        categoryId = await suggestCategoryForPayee(
          supabase,
          active.budget.id,
          item.payload.payee.trim(),
        );
      }

      const amountCents =
        item.payload.direction === "inflow" ? Math.abs(amount) : -Math.abs(amount);

      const { error } = await supabase.from("transactions").insert({
        user_id: user.id,
        budget_id: active.budget.id,
        account_id: item.payload.account_id,
        category_id: categoryId,
        occurred_on: item.payload.occurred_on,
        payee: item.payload.payee.trim(),
        memo: item.payload.memo.trim(),
        amount_cents: amountCents,
        cleared: true,
      });

      if (error) {
        failed.push({ id: item.id, error: error.message });
        continue;
      }
      applied.push(item.id);
    } catch (error) {
      failed.push({
        id: item.id,
        error: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }

  return NextResponse.json({ applied, failed });
}

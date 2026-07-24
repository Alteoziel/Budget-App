import { NextResponse } from "next/server";
import { resolveActiveBudget, roleAtLeast } from "@/lib/budget-context";
import { encryptSecret } from "@/lib/crypto/secrets";
import { getPlaidClient, plaidConfigured, plaidErrorMessage } from "@/lib/plaid/client";
import { ensureLocalAccountsForItem, syncPlaidItem } from "@/lib/plaid/sync";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Body = {
  public_token?: string;
  institution?: { institution_id?: string; name?: string } | null;
};

export async function POST(req: Request) {
  if (!plaidConfigured()) {
    return NextResponse.json(
      { error: "Plaid is not configured on this deployment." },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const publicToken = body.public_token?.trim();
  if (!publicToken) {
    return NextResponse.json({ error: "public_token is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const active = await resolveActiveBudget();
  if (!active) {
    return NextResponse.json({ error: "No active budget." }, { status: 400 });
  }
  if (!roleAtLeast(active.role, "admin")) {
    return NextResponse.json({ error: "Admin role required." }, { status: 403 });
  }

  try {
    const client = getPlaidClient();
    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;
    const institutionName = body.institution?.name || "Linked bank";
    const institutionId = body.institution?.institution_id || null;

    const { data: item, error: itemErr } = await supabase
      .from("plaid_items")
      .upsert(
        {
          budget_id: active.budget.id,
          item_id: itemId,
          institution_id: institutionId,
          institution_name: institutionName,
          status: "active",
          access_token_encrypted: encryptSecret(accessToken),
          created_by: user.id,
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "budget_id,item_id" },
      )
      .select("id,budget_id,access_token_encrypted,sync_cursor,created_by")
      .single();

    if (itemErr || !item) {
      return NextResponse.json(
        { error: itemErr?.message || "Could not save Plaid item." },
        { status: 500 },
      );
    }

    const accounts = await ensureLocalAccountsForItem(supabase, {
      budgetId: active.budget.id,
      userId: user.id,
      itemRowId: item.id,
      accessToken,
      institutionName,
    });

    const started = new Date().toISOString();
    const syncResult = await syncPlaidItem(supabase, item);
    await supabase.from("sync_runs").insert({
      budget_id: active.budget.id,
      plaid_item_id: item.id,
      source: "manual",
      started_at: started,
      finished_at: new Date().toISOString(),
      inserted: syncResult.inserted,
      updated: syncResult.updated,
      errors: syncResult.errors.length
        ? syncResult.errors.join("\n").slice(0, 4000)
        : null,
    });

    return NextResponse.json({
      ok: true,
      itemId: item.id,
      accounts,
      inserted: syncResult.inserted,
      updated: syncResult.updated,
      removed: syncResult.removed,
      errors: syncResult.errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: plaidErrorMessage(e, "Plaid exchange failed") },
      { status: 500 },
    );
  }
}

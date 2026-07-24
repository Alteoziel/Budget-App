import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { syncPlaidItem } from "@/lib/plaid/sync";
import { plaidConfigured } from "@/lib/plaid/client";

export const dynamic = "force-dynamic";

/** Optional: Plaid can notify when transactions are ready. Auth is open but scoped to item_id lookups. */
export async function POST(req: Request) {
  if (!plaidConfigured()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: { webhook_type?: string; webhook_code?: string; item_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.webhook_type !== "TRANSACTIONS" || !body.item_id) {
    return NextResponse.json({ ok: true });
  }

  try {
    const supabase = createServiceClient();
    const { data: item } = await supabase
      .from("plaid_items")
      .select("id,budget_id,access_token_encrypted,sync_cursor,created_by,status")
      .eq("item_id", body.item_id)
      .neq("status", "disconnected")
      .maybeSingle();

    if (!item) return NextResponse.json({ ok: true });

    const started = new Date().toISOString();
    const result = await syncPlaidItem(supabase, item);
    await supabase.from("sync_runs").insert({
      budget_id: item.budget_id,
      plaid_item_id: item.id,
      source: "plaid",
      started_at: started,
      finished_at: new Date().toISOString(),
      inserted: result.inserted,
      updated: result.updated,
      errors: result.errors.length ? result.errors.join("\n").slice(0, 4000) : null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Webhook sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

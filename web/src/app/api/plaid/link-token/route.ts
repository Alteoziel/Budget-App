import { NextResponse } from "next/server";
import { resolveActiveBudget, roleAtLeast } from "@/lib/budget-context";
import { createClient } from "@/lib/supabase/server";
import {
  getPlaidClient,
  PLAID_COUNTRY_CODES,
  PLAID_PRODUCTS,
  plaidConfigured,
} from "@/lib/plaid/client";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!plaidConfigured()) {
    return NextResponse.json(
      { error: "Plaid is not configured on this deployment." },
      { status: 503 },
    );
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
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    const response = await client.linkTokenCreate({
      user: { client_user_id: `${active.budget.id}:${user.id}` },
      client_name: "Alte' Budgeting",
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
      language: "en",
      ...(siteUrl ? { webhook: `${siteUrl}/api/plaid/webhook` } : {}),
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create link token.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

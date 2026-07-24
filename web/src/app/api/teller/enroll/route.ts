import { NextResponse } from "next/server";
import { resolveActiveBudget, roleAtLeast } from "@/lib/budget-context";
import { createClient } from "@/lib/supabase/server";
import {
  listTellerAccounts,
  mapTellerAccountType,
  tellerConfigured,
} from "@/lib/teller/client";
import { encryptSecret } from "@/lib/teller/crypto";
import { syncEnrollment } from "@/lib/teller/sync";

export const dynamic = "force-dynamic";

type Body = {
  accessToken?: string;
  enrollment?: {
    id?: string;
    institution?: { name?: string };
  };
};

export async function POST(req: Request) {
  if (!tellerConfigured()) {
    return NextResponse.json(
      { error: "Teller is not configured on this deployment." },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const accessToken = body.accessToken?.trim();
  const enrollmentId = body.enrollment?.id?.trim();
  if (!accessToken || !enrollmentId) {
    return NextResponse.json(
      { error: "accessToken and enrollment.id are required." },
      { status: 400 },
    );
  }

  try {
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
    const budget = active.budget;
    const institutionName = body.enrollment?.institution?.name || "Linked bank";

    const tellerAccounts = await listTellerAccounts(accessToken);

    const { data: enrollment, error: enrollErr } = await supabase
      .from("teller_enrollments")
      .upsert(
        {
          budget_id: budget.id,
          enrollment_id: enrollmentId,
          institution_name: institutionName,
          status: "active",
          access_token_encrypted: encryptSecret(accessToken),
          created_by: user.id,
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "budget_id,enrollment_id" },
      )
      .select("id,budget_id,access_token_encrypted,last_synced_at,created_by")
      .single();

    if (enrollErr || !enrollment) {
      return NextResponse.json(
        { error: enrollErr?.message || "Could not save enrollment." },
        { status: 500 },
      );
    }

    for (const ta of tellerAccounts) {
      const name =
        ta.name ||
        `${institutionName} ${ta.subtype || ta.type}${ta.last_four ? ` ·${ta.last_four}` : ""}`;

      const { data: existingMap } = await supabase
        .from("teller_accounts")
        .select("id,account_id")
        .eq("budget_id", budget.id)
        .eq("teller_account_id", ta.id)
        .maybeSingle();

      let accountId = existingMap?.account_id as string | undefined;
      if (!accountId) {
        const { data: account, error: accErr } = await supabase
          .from("accounts")
          .insert({
            user_id: user.id,
            budget_id: budget.id,
            name: name.slice(0, 80),
            account_type: mapTellerAccountType(ta.type, ta.subtype),
            currency: (ta.currency || "USD").toUpperCase(),
          })
          .select("id")
          .single();

        if (accErr || !account) {
          // Name collision — try a unique suffix
          const { data: retry } = await supabase
            .from("accounts")
            .insert({
              user_id: user.id,
              budget_id: budget.id,
              name: `${name.slice(0, 60)} (${ta.id.slice(-6)})`,
              account_type: mapTellerAccountType(ta.type, ta.subtype),
              currency: (ta.currency || "USD").toUpperCase(),
            })
            .select("id")
            .single();
          accountId = retry?.id;
        } else {
          accountId = account.id;
        }
      }

      if (!accountId) continue;

      await supabase.from("teller_accounts").upsert(
        {
          budget_id: budget.id,
          enrollment_id: enrollment.id,
          teller_account_id: ta.id,
          account_id: accountId,
        },
        { onConflict: "budget_id,teller_account_id" },
      );
    }

    const started = new Date().toISOString();
    const syncResult = await syncEnrollment(supabase, enrollment, {
      backfillDays: 90,
    });

    await supabase.from("sync_runs").insert({
      budget_id: budget.id,
      enrollment_id: enrollment.id,
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
      enrollmentId: enrollment.id,
      accounts: tellerAccounts.length,
      inserted: syncResult.inserted,
      updated: syncResult.updated,
      errors: syncResult.errors,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Enrollment failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

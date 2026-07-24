import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { syncAllActiveEnrollments } from "@/lib/teller/sync";
import { tellerConfigured } from "@/lib/teller/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!tellerConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Teller cert/app id not configured",
    });
  }

  try {
    const supabase = createServiceClient();
    const result = await syncAllActiveEnrollments(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

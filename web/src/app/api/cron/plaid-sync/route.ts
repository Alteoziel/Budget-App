import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { plaidConfigured } from "@/lib/plaid/client";
import { authorizeCronRequest } from "@/lib/plaid/cron-auth";
import { syncAllActivePlaidItems } from "@/lib/plaid/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export const revalidate = 0;

function json(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

async function runPlaidCron(req: Request): Promise<NextResponse> {
  const startedMs = Date.now();
  const at = new Date().toISOString();
  console.info("[cron/plaid-sync] invoked", {
    at,
    method: req.method,
    hasAuth: Boolean(req.headers.get("authorization")),
    vercelCron: req.headers.get("x-vercel-cron") ?? null,
    schedule: req.headers.get("x-vercel-cron-schedule") ?? null,
  });

  const auth = authorizeCronRequest(req);
  if (!auth.ok) {
    console.error("[cron/plaid-sync] unauthorized", auth.reason);
    return json({ ok: false, error: auth.reason ?? "Unauthorized" }, 401);
  }

  if (!plaidConfigured()) {
    console.warn("[cron/plaid-sync] skipped — Plaid not configured");
    return json({
      ok: true,
      skipped: true,
      reason: "Plaid client id/secret not configured",
      durationMs: Date.now() - startedMs,
    });
  }

  try {
    const supabase = createServiceClient();
    const result = await syncAllActivePlaidItems(supabase, {
      source: "cron",
      retries: 1,
    });
    const payload = {
      ok: result.errors.length === 0,
      ...result,
      durationMs: Date.now() - startedMs,
    };
    console.info("[cron/plaid-sync] finished", payload);
    // Always 200 when the handler ran — item-level errors live in the JSON body
    // and sync_runs so Vercel still records a successful invocation with logs.
    return json(payload, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    console.error("[cron/plaid-sync] fatal", message);
    return json(
      { ok: false, error: message, durationMs: Date.now() - startedMs },
      500,
    );
  }
}

/** Vercel Cron invokes GET. */
export async function GET(req: Request) {
  return runPlaidCron(req);
}

/** Manual / ops probes can POST with the same Bearer secret. */
export async function POST(req: Request) {
  return runPlaidCron(req);
}

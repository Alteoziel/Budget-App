import { NextRequest, NextResponse } from "next/server";
import {
  SITE_AUTH_COOKIE,
  mintSiteSessionToken,
  passwordsMatch,
  siteGateEnabled,
  sitePassword,
  siteSessionCookieOptions,
} from "@/lib/siteAuth";
import { consumeLoginAttempt } from "@/lib/loginRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!siteGateEnabled()) {
    return NextResponse.json(
      {
        error: "site_gate_disabled",
        message:
          "GOVERNANCE_SITE_PASSWORD is not set — site gate is off on this deploy.",
      },
      { status: 400 },
    );
  }

  if (!(await consumeLoginAttempt(req))) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: "Too many login attempts. Try again in a minute.",
      },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const expected = sitePassword();
  if (!expected) {
    return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  }

  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > 4096) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: { password?: string } = {};
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Expected JSON body with password." },
      { status: 400 },
    );
  }

  const provided =
    typeof body.password === "string" && body.password.length <= 1024
      ? body.password
      : "";
  if (!provided || !(await passwordsMatch(provided, expected))) {
    return NextResponse.json(
      { error: "unauthorized", message: "Incorrect password." },
      { status: 401 },
    );
  }

  const { token, expiresAt } = await mintSiteSessionToken(expected);
  const res = NextResponse.json({
    ok: true,
    expires_at: expiresAt,
  });
  res.cookies.set(SITE_AUTH_COOKIE, token, siteSessionCookieOptions(expiresAt));
  return res;
}

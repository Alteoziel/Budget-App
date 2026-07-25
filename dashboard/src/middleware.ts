import { NextRequest, NextResponse } from "next/server";
import {
  SITE_AUTH_COOKIE,
  siteGateEnabled,
  sitePassword,
  verifySiteSessionToken,
} from "@/lib/siteAuth";
import { secretsMatch, isProductionLike } from "@/lib/auth";

export const config = {
  matcher: [
    /*
     * Gate everything except Next static assets and common public files.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

function isAuthPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/health"
  );
}

function hasGovernanceMachineAuth(req: NextRequest): boolean {
  const dashboard = process.env.GOVERNANCE_DASHBOARD_SECRET?.trim();
  const reviewer = process.env.GOVERNANCE_REVIEWER_SECRET?.trim();
  if (!dashboard && !reviewer) return false;

  const ingest = req.headers.get("x-governance-secret");
  const review = req.headers.get("x-governance-reviewer-secret");

  if (dashboard && secretsMatch(ingest, dashboard)) return true;
  if (
    reviewer &&
    (!dashboard || !secretsMatch(reviewer, dashboard)) &&
    secretsMatch(review, reviewer)
  ) {
    return true;
  }
  return false;
}

function loginRedirect(req: NextRequest): NextResponse {
  const login = new URL("/login", req.url);
  const next = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (next && next !== "/login") {
    login.searchParams.set("next", next);
  }
  return NextResponse.redirect(login);
}

function unauthorizedApi(): NextResponse {
  return NextResponse.json(
    {
      error: "unauthorized",
      message:
        "Site password required. Open /login or send a valid X-Governance-Secret.",
    },
    { status: 401 },
  );
}

function misconfigured(): NextResponse {
  return NextResponse.json(
    {
      error: "misconfigured",
      message:
        "Set GOVERNANCE_SITE_PASSWORD for production dashboard access (or use machine auth headers on APIs).",
    },
    { status: 503 },
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Production/Vercel: site gate must be configured (fail closed for humans).
  if (isProductionLike() && !siteGateEnabled()) {
    if (isAuthPublicPath(pathname) || hasGovernanceMachineAuth(req)) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return misconfigured();
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (!siteGateEnabled()) {
    return NextResponse.next();
  }

  if (isAuthPublicPath(pathname)) {
    return NextResponse.next();
  }

  // CI ingest + automation keep working with the existing shared secrets.
  if (hasGovernanceMachineAuth(req)) {
    return NextResponse.next();
  }

  const password = sitePassword();
  if (!password) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SITE_AUTH_COOKIE)?.value;
  const ok = await verifySiteSessionToken(token, password);
  if (ok) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return unauthorizedApi();
  }

  return loginRedirect(req);
}

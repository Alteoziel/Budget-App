import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasRecentPrimarySignIn } from "@/lib/auth/reauth";

function isPublicPath(path: string): boolean {
  return (
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/invite") ||
    path.startsWith("/auth/") ||
    path.startsWith("/api/cron/") ||
    path.startsWith("/api/plaid/webhook") ||
    path.startsWith("/_next") ||
    path.startsWith("/icons") ||
    path === "/manifest.webmanifest" ||
    path === "/sw.js" ||
    path === "/offline.html"
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;

  // Cron must never hit auth/redirect logic (Vercel cron does not follow redirects
  // and failed middleware often leaves no useful function logs).
  if (path.startsWith("/api/cron/")) {
    return supabaseResponse;
  }

  // Fail closed: without Supabase env, only public routes are reachable.
  if (!url || !anonKey) {
    if (!isPublicPath(path)) {
      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set("next", path);
      return NextResponse.redirect(redirectUrl);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = path.startsWith("/login");
  const isInviteRoute = path.startsWith("/invite");
  const isAuthCallback = path.startsWith("/auth/");
  const isPlaidWebhook = path.startsWith("/api/plaid/webhook");
  const isPublicAsset =
    path.startsWith("/_next") ||
    path.startsWith("/icons") ||
    path === "/manifest.webmanifest" ||
    path === "/sw.js" ||
    path === "/offline.html";

  if (
    user &&
    !isAuthCallback &&
    !isPlaidWebhook &&
    !path.startsWith("/api/cron/") &&
    !isPublicAsset &&
    !hasRecentPrimarySignIn(user.last_sign_in_at)
  ) {
    await supabase.auth.signOut();
    const nextPath = `${path}${request.nextUrl.search}`;
    const expiredMessage =
      "Your 14-day session expired. Sign in again to continue.";

    if (path.startsWith("/api/")) {
      const response = NextResponse.json(
        { error: expiredMessage, code: "REAUTH_REQUIRED" },
        { status: 401 },
      );
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        response.cookies.set(cookie);
      });
      return response;
    }

    const redirectUrl = new URL("/login", request.url);
    if (!isAuthRoute && path !== "/") {
      redirectUrl.searchParams.set("next", nextPath);
    }
    redirectUrl.searchParams.set("error", expiredMessage);
    const response = NextResponse.redirect(redirectUrl);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });
    return response;
  }

  if (
    !user &&
    !isAuthRoute &&
    !isInviteRoute &&
    !isAuthCallback &&
    !isPlaidWebhook &&
    !isPublicAsset &&
    path !== "/"
  ) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && (isAuthRoute || path === "/")) {
    return NextResponse.redirect(new URL("/budget", request.url));
  }

  return supabaseResponse;
}

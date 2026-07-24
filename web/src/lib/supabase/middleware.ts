import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function isPublicPath(path: string): boolean {
  return (
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/invite") ||
    path.startsWith("/api/cron/") ||
    path.startsWith("/api/plaid/webhook") ||
    path.startsWith("/_next") ||
    path.startsWith("/icons") ||
    path === "/manifest.webmanifest" ||
    path === "/sw.js"
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;

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
  const isCronRoute = path.startsWith("/api/cron/");
  const isPlaidWebhook = path.startsWith("/api/plaid/webhook");
  const isPublicAsset =
    path.startsWith("/_next") ||
    path.startsWith("/icons") ||
    path === "/manifest.webmanifest" ||
    path === "/sw.js";

  if (
    !user &&
    !isAuthRoute &&
    !isInviteRoute &&
    !isCronRoute &&
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

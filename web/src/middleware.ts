import { type NextRequest } from "next/server";
import { applyCspToRequest, createRequestNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const nonce = createRequestNonce();
  const { request: cspRequest, csp } = applyCspToRequest(request, nonce);
  const response = await updateSession(cspRequest);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Skip cron entirely — middleware auth/Supabase work can fail or redirect
     * before the route runs, which Vercel reports as a cron failure with no logs.
     * Skip PWA shell files so /boot.html is never 307'd to /login (Chrome ERR_FAILED
     * after password/passkey sign-in) and so inline scripts are not nonce-blocked.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/cron/|boot\\.html$|offline\\.html$|sw\\.js$|manifest\\.webmanifest$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

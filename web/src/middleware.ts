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
     */
    "/((?!_next/static|_next/image|favicon.ico|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

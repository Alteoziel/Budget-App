import { NextRequest } from "next/server";

/** Per-request CSP nonce (base64). */
export function createRequestNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * Production script-src uses nonces + strict-dynamic (no unsafe-inline/unsafe-eval).
 * Dev still allows unsafe-eval for React error overlays.
 */
export function buildContentSecurityPolicy(
  nonce: string,
  options?: { isDev?: boolean },
): string {
  const isDev = options?.isDev ?? process.env.NODE_ENV === "development";
  const scriptSrc = [
    "script-src",
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // Host fallback for older browsers that ignore strict-dynamic.
    "https://cdn.plaid.com",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    scriptSrc,
    // React style attributes / CSS-in-JS still need this; styles are lower XSS risk than scripts.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.plaid.com https://production.plaid.com https://sandbox.plaid.com https://development.plaid.com",
    "frame-src https://cdn.plaid.com https://*.plaid.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Attach nonce + CSP to the request so Next can stamp framework scripts. */
export function applyCspToRequest(
  request: NextRequest,
  nonce: string,
): { request: NextRequest; csp: string } {
  const csp = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  return {
    request: new NextRequest(request, { headers: requestHeaders }),
    csp,
  };
}

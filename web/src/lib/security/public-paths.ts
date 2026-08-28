/**
 * Paths that must never be sent through auth redirects.
 *
 * `/boot.html` is the PWA dark splash the service worker paints on cache-miss
 * navigations. If middleware 307s it to `/login?next=/boot.html`, Chrome
 * reports ERR_FAILED ("This site can't be reached") after password/passkey
 * sign-in, and `cache.addAll(["/boot.html"])` fails because the Cache API
 * rejects redirected responses.
 */
export function isPublicAssetPath(path: string): boolean {
  if (
    path === "/boot.html" ||
    path === "/offline.html" ||
    path === "/sw.js" ||
    path === "/manifest.webmanifest" ||
    path === "/favicon.ico"
  ) {
    return true;
  }
  return (
    path.startsWith("/_next") ||
    path.startsWith("/icons") ||
    path.startsWith("/splash")
  );
}

export function isPublicPath(path: string): boolean {
  if (isPublicAssetPath(path)) return true;
  return (
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/invite") ||
    path.startsWith("/auth/") ||
    path.startsWith("/api/cron/") ||
    path.startsWith("/api/plaid/webhook")
  );
}

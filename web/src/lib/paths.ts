function pathOnly(value: string): string {
  return value.split("?")[0].split("#")[0];
}

/** PWA/static shells must not be post-login destinations. */
function isForbiddenNextPath(path: string): boolean {
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
    path.startsWith("/icons/") ||
    path.startsWith("/splash/") ||
    path.startsWith("/api/")
  );
}

/** Allow only same-origin relative paths (blocks //evil.com open redirects). */
export function safeInternalPath(
  next: string | null | undefined,
  fallback = "/budget",
): string {
  if (!next) return fallback;
  const value = next.trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.includes("\\") || value.includes("://")) return fallback;
  // Reject encoded slash/backslash tricks before they normalize to //host.
  if (/%2f|%5c/i.test(value)) return fallback;
  if (value.includes("..")) return fallback;
  if (isForbiddenNextPath(pathOnly(value))) return fallback;
  return value;
}

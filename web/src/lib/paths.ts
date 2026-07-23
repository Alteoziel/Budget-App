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
  return value;
}

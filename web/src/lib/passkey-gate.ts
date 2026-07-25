/**
 * Decide what happens after a successful email/password authentication.
 *
 * - Has passkeys → password is a fallback: require email approval (no session yet).
 * - No passkeys → offer passkey enrollment.
 * - Passkey API unavailable → continue to the app (feature not enabled yet).
 */
export type PasswordLoginGate =
  | { kind: "email_approval" }
  | { kind: "passkey_setup"; next: string }
  | { kind: "continue"; next: string };

export function resolvePasswordLoginGate(options: {
  passkeyCount: number | null;
  passkeyCheckOk: boolean;
  next: string;
}): PasswordLoginGate {
  if (options.passkeyCheckOk && (options.passkeyCount ?? 0) > 0) {
    return { kind: "email_approval" };
  }
  if (options.passkeyCheckOk && (options.passkeyCount ?? 0) === 0) {
    return { kind: "passkey_setup", next: options.next };
  }
  return { kind: "continue", next: options.next };
}

export function isPasskeyApiUnavailable(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "passkey_disabled" ||
    message.includes("passkey_disabled") ||
    (message.includes("passkey") && message.includes("disabled")) ||
    message.includes("experimental")
  );
}

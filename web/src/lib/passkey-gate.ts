/**
 * Decide what happens after a successful email/password authentication.
 *
 * Passkey and password are both first-class sign-in methods. Password never
 * requires an extra email confirmation step, whether or not a passkey exists.
 *
 * - No passkeys → offer passkey enrollment (optional).
 * - Has passkeys, or passkey API unavailable → continue to the app.
 */
export type PasswordLoginGate =
  | { kind: "passkey_setup"; next: string }
  | { kind: "continue"; next: string };

export function resolvePasswordLoginGate(options: {
  passkeyCount: number | null;
  passkeyCheckOk: boolean;
  next: string;
}): PasswordLoginGate {
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

import { NextResponse, type NextRequest } from "next/server";
import {
  grantPasswordReset,
  verifyRecoveryState,
} from "@/lib/password-reset";
import { safeInternalPath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType, SupabaseClient } from "@supabase/supabase-js";

/**
 * Handles Supabase email links (password recovery, signup confirmation, etc.).
 *
 * Password-reset grants require a signed recovery_state (or recovery OTP type).
 */

/** Supabase email OTP kinds we accept from the callback query string. */
const ALLOWED_OTP_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const satisfies readonly EmailOtpType[];

type AllowedOtpType = (typeof ALLOWED_OTP_TYPES)[number];

type AuthCredential =
  | { kind: "pkce"; code: string }
  | { kind: "otp"; tokenHash: string; type: AllowedOtpType };

function parseAllowedOtpType(raw: string | null): AllowedOtpType | null {
  if (!raw) return null;
  for (const allowed of ALLOWED_OTP_TYPES) {
    if (allowed === raw) return allowed;
  }
  return null;
}

/**
 * Parse callback credentials into a closed union.
 * Values are treated as opaque credentials for Supabase verification — never as
 * authorization bypass flags.
 */
function parseAuthCredential(
  searchParams: URLSearchParams,
): AuthCredential | null {
  const code = searchParams.get("code");
  if (typeof code === "string" && code.length > 0) {
    return { kind: "pkce", code };
  }

  const tokenHash = searchParams.get("token_hash");
  const type = parseAllowedOtpType(searchParams.get("type"));
  if (typeof tokenHash === "string" && tokenHash.length > 0 && type) {
    return { kind: "otp", tokenHash, type };
  }

  return null;
}

async function verifyAuthCredential(
  supabase: SupabaseClient,
  credential: AuthCredential,
): Promise<{ error: { message: string } | null }> {
  switch (credential.kind) {
    case "pkce":
      return supabase.auth.exchangeCodeForSession(credential.code);
    case "otp":
      return supabase.auth.verifyOtp({
        type: credential.type,
        token_hash: credential.tokenHash,
      });
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const { origin } = url;
  const requestedNext = url.searchParams.get("next");
  const recoveryState = url.searchParams.get("recovery_state");

  const credential = parseAuthCredential(url.searchParams);
  if (!credential) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Invalid or expired confirmation link.")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await verifyAuthCredential(supabase, credential);
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Could not verify the signed-in user.")}`,
    );
  }

  // Recovery is decided only by verified OTP type or a signed recovery_state —
  // never by the mere presence of a query parameter.
  const isRecovery =
    (credential.kind === "otp" && credential.type === "recovery") ||
    verifyRecoveryState(recoveryState, user.id);

  if (isRecovery) {
    await grantPasswordReset(user.id);
  }

  const next = safeInternalPath(
    requestedNext,
    isRecovery ? "/settings/password" : "/budget",
  );
  return NextResponse.redirect(`${origin}${next}`);
}

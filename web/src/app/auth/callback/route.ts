import { NextResponse, type NextRequest } from "next/server";
import {
  grantPasswordReset,
  verifyRecoveryState,
} from "@/lib/password-reset";
import { safeInternalPath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Handles Supabase email links (password recovery, signup confirmation, etc.).
 *
 * Password-reset grants require a signed recovery_state (or recovery OTP type).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const requestedNext = searchParams.get("next");
  const recoveryState = searchParams.get("recovery_state");

  const supabase = await createClient();
  let isRecovery = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`,
      );
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (error) {
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`,
      );
    }
    isRecovery = type === "recovery";
  } else {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Invalid or expired confirmation link.")}`,
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

  if (code) {
    isRecovery = verifyRecoveryState(recoveryState, user.id);
  }

  if (isRecovery) {
    await grantPasswordReset(user.id);
  }

  const next = safeInternalPath(
    requestedNext,
    isRecovery ? "/settings/password" : "/budget",
  );
  return NextResponse.redirect(`${origin}${next}`);
}

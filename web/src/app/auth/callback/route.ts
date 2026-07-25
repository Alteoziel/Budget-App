import { NextResponse, type NextRequest } from "next/server";
import { grantPasswordReset } from "@/lib/password-reset";
import { safeInternalPath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Handles Supabase email links (password recovery, etc.).
 * After a recovery confirmation, grants a short-lived cookie so the user can
 * set a new password on /settings/password.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeInternalPath(
    searchParams.get("next"),
    "/settings/password",
  );

  const supabase = await createClient();
  let isRecovery = type === "recovery" || next.startsWith("/settings/password");

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

  if (isRecovery) {
    await grantPasswordReset();
  }

  return NextResponse.redirect(`${origin}${next}`);
}

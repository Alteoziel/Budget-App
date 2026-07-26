import { NextResponse, type NextRequest } from "next/server";
import {
  isPasskeyApiUnavailable,
} from "@/lib/passkey-gate";
import {
  grantPasswordReset,
  verifyLoginApprovalState,
  verifyRecoveryState,
} from "@/lib/password-reset";
import { safeInternalPath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

async function userHasPasskeys(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.auth.passkey.list();
    if (error) {
      if (isPasskeyApiUnavailable(error)) return null;
      return null;
    }
    return (data?.length ?? 0) > 0;
  } catch (error) {
    if (
      isPasskeyApiUnavailable(
        error instanceof Error ? { message: error.message } : null,
      )
    ) {
      return null;
    }
    return null;
  }
}

/**
 * Handles Supabase email links (password recovery, password+email login
 * approval for passkey accounts, etc.).
 *
 * Password-reset grants require a signed recovery_state (or recovery OTP type).
 * Passkey-protected accounts reject bare magic-link sessions unless a signed
 * login_approval_state from password verification is present.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const requestedNext = searchParams.get("next");
  const recoveryState = searchParams.get("recovery_state");
  const loginApprovalState = searchParams.get("login_approval_state");

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

  const passwordFallbackApproved = verifyLoginApprovalState(
    loginApprovalState,
    user.id,
  );

  if (isRecovery) {
    await grantPasswordReset(user.id);
  } else {
    const hasPasskeys = await userHasPasskeys(supabase);
    // Fail closed for passkey accounts: email links alone are not enough.
    // Password fallback must carry a server-signed login_approval_state.
    if (hasPasskeys === true && !passwordFallbackApproved) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(
          "This account uses a passkey. Sign in with your passkey, or use password sign-in to request an email approval link.",
        )}`,
      );
    }
  }

  const next = safeInternalPath(
    requestedNext,
    isRecovery ? "/settings/password" : "/budget",
  );
  return NextResponse.redirect(`${origin}${next}`);
}

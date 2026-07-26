import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";

/** Signed HttpOnly grant set after the user confirms a recovery email link. */
export const PASSWORD_RESET_COOKIE = "alte_pw_reset_ok";

/** How long the post-email password form stays available. */
export const PASSWORD_RESET_TTL_SECONDS = 15 * 60;

const RECOVERY_STATE_TTL_SECONDS = 60 * 60;

type GrantPurpose = "password-reset" | "recovery-state";

function signingSecret(): string {
  const secret = process.env.APP_SECURITY_SECRET;
  if (!secret) {
    throw new Error(
      "Missing APP_SECURITY_SECRET. Set a dedicated random secret in Doppler " +
        "(do not reuse the Supabase service/secret key).",
    );
  }
  return secret;
}

function signGrant(
  userId: string,
  purpose: GrantPurpose,
  ttlSeconds: number,
  nowMs = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      purpose,
      exp: Math.floor(nowMs / 1000) + ttlSeconds,
      nonce: randomBytes(16).toString("base64url"),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", signingSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifyGrant(
  token: string | null | undefined,
  userId: string,
  purpose: GrantPurpose,
  nowMs = Date.now(),
): boolean {
  if (!token || token.length > 2048) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = createHmac("sha256", signingSecret())
    .update(payload)
    .digest("base64url");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    return false;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      sub?: unknown;
      purpose?: unknown;
      exp?: unknown;
      nonce?: unknown;
    };
    return (
      decoded.sub === userId &&
      decoded.purpose === purpose &&
      typeof decoded.nonce === "string" &&
      decoded.nonce.length >= 16 &&
      typeof decoded.exp === "number" &&
      Number.isSafeInteger(decoded.exp) &&
      decoded.exp > Math.floor(nowMs / 1000)
    );
  } catch {
    return false;
  }
}

export function createRecoveryState(userId: string): string {
  return signGrant(
    userId,
    "recovery-state",
    RECOVERY_STATE_TTL_SECONDS,
  );
}

export function verifyRecoveryState(
  token: string | null | undefined,
  userId: string,
): boolean {
  return verifyGrant(token, userId, "recovery-state");
}

export async function grantPasswordReset(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(
    PASSWORD_RESET_COOKIE,
    signGrant(userId, "password-reset", PASSWORD_RESET_TTL_SECONDS),
    {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PASSWORD_RESET_TTL_SECONDS,
    path: "/",
    },
  );
}

export async function hasPasswordResetGrant(userId: string): Promise<boolean> {
  const jar = await cookies();
  return verifyGrant(
    jar.get(PASSWORD_RESET_COOKIE)?.value,
    userId,
    "password-reset",
  );
}

export async function clearPasswordResetGrant(): Promise<void> {
  const jar = await cookies();
  jar.delete(PASSWORD_RESET_COOKIE);
}

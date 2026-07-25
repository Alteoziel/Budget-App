import { cookies } from "next/headers";

/** HttpOnly flag set after the user confirms a recovery email link. */
export const PASSWORD_RESET_COOKIE = "alte_pw_reset_ok";

/** How long the post-email password form stays available. */
export const PASSWORD_RESET_TTL_SECONDS = 15 * 60;

export async function grantPasswordReset(): Promise<void> {
  const jar = await cookies();
  jar.set(PASSWORD_RESET_COOKIE, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PASSWORD_RESET_TTL_SECONDS,
    path: "/",
  });
}

export async function hasPasswordResetGrant(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(PASSWORD_RESET_COOKIE)?.value === "1";
}

export async function clearPasswordResetGrant(): Promise<void> {
  const jar = await cookies();
  jar.delete(PASSWORD_RESET_COOKIE);
}

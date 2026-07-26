import Link from "next/link";
import { PasskeySignInButton } from "@/components/PasskeySignInButton";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import { signInAction, signUpAction } from "@/lib/actions";
import { safeInternalPath } from "@/lib/paths";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    notice?: string;
    mode?: string;
    next?: string;
  }>;
}) {
  const params = await searchParams;
  const isSignup = params.mode === "signup";
  const nextPath = safeInternalPath(params.next ?? "/budget");

  return (
    <main className="flex min-h-dvh items-center bg-app-glow px-5 py-10">
      <div className="mx-auto w-full max-w-md animate-rise card-surface rounded-2xl p-6 backdrop-blur">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-moss-500">
          Alte&apos; Budgeting
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink-900">
          {isSignup ? "Create your budget" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-ink-600">
          Private by design. Your numbers stay in your Supabase project.
        </p>

        {params.notice ? (
          <p className="mt-4 rounded-xl bg-moss-500/15 px-3 py-2 text-sm text-moss-600">
            {params.notice}
          </p>
        ) : null}

        {params.error ? (
          <p className="mt-4 rounded-xl bg-coral-400/15 px-3 py-2 text-sm text-coral-500">
            {params.error}
          </p>
        ) : null}

        {!isSignup ? (
          <div className="mt-6 space-y-4">
            <PasskeySignInButton next={nextPath} />
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-ink-600">
              <span className="h-px flex-1 bg-ink-900/10" />
              Or use password
              <span className="h-px flex-1 bg-ink-900/10" />
            </div>
          </div>
        ) : null}

        <form
          action={isSignup ? signUpAction : signInAction}
          className={`${isSignup ? "mt-6" : "mt-4"} space-y-3`}
        >
          <input type="hidden" name="next" value={nextPath} />
          {isSignup ? (
            <label className="block text-sm font-semibold text-ink-700">
              Display name
              <input
                name="displayName"
                className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
                placeholder="Your name"
              />
            </label>
          ) : null}
          <label className="block text-sm font-semibold text-ink-700">
            Email
            <input
              required
              type="email"
              name="email"
              autoComplete="email"
              className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
              placeholder="you@example.com"
            />
          </label>
          <label className="block text-sm font-semibold text-ink-700">
            Password
            <input
              required
              type="password"
              name="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              minLength={8}
              className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
              placeholder="••••••••"
            />
          </label>
          <PendingSubmitButton
            pendingLabel={isSignup ? "Creating…" : "Signing in…"}
            className="w-full rounded-2xl bg-ink-900 px-4 py-3.5 text-sm font-bold text-sand-50 hover:bg-ink-800"
          >
            {isSignup ? "Create account" : "Sign in with password"}
          </PendingSubmitButton>
        </form>

        {!isSignup ? (
          <p className="mt-3 text-xs text-ink-600">
            Sign in with a passkey or with your email and password — either
            works.
          </p>
        ) : null}

        <p className="mt-5 text-center text-sm text-ink-600">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-bold text-moss-500">
                Sign in
              </Link>
            </>
          ) : (
            <>
              New here?{" "}
              <Link href="/login?mode=signup" className="font-bold text-moss-500">
                Create an account
              </Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}

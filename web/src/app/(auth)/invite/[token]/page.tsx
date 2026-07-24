import Link from "next/link";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import { acceptInviteAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-dvh items-center bg-app-glow px-5 py-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md card-surface rounded-2xl p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-moss-500">
          Alte&apos; Budgeting
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink-900">
          Join a budget
        </h1>
        <p className="mt-2 text-sm text-ink-600">
          Someone invited you to collaborate with a specific role.
        </p>
        {query.error ? (
          <p className="mt-4 rounded-xl bg-coral-400/15 px-3 py-2 text-sm text-coral-500">
            {query.error}
          </p>
        ) : null}

        {user ? (
          <form action={acceptInviteAction} className="mt-6">
            <input type="hidden" name="token" value={token} />
            <PendingSubmitButton
              pendingLabel="Joining…"
              className="w-full rounded-2xl bg-ink-900 px-4 py-3.5 text-sm font-bold text-sand-50"
            >
              Accept invite
            </PendingSubmitButton>
          </form>
        ) : (
          <div className="mt-6 space-y-3">
            <Link
              href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="flex min-h-11 w-full touch-manipulation items-center justify-center rounded-2xl bg-ink-900 px-4 py-3.5 text-sm font-bold text-sand-50"
            >
              Sign in to accept
            </Link>
            <Link
              href={`/login?mode=signup&next=${encodeURIComponent(`/invite/${token}`)}`}
              className="flex min-h-11 w-full touch-manipulation items-center justify-center rounded-2xl bg-moss-500 px-4 py-3.5 text-sm font-bold text-sand-50"
            >
              Create account to accept
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

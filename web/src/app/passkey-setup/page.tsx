import { redirect } from "next/navigation";
import { PasskeySetupPanel } from "@/components/PasskeySetupPanel";
import { safeInternalPath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";

export default async function PasskeySetupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeInternalPath(params.next ?? "/budget");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/passkey-setup")}`);
  }

  try {
    const { data, error } = await supabase.auth.passkey.list();
    if (!error && (data?.length ?? 0) > 0) {
      redirect(nextPath);
    }
  } catch {
    // Passkeys may be disabled on the project — still show the setup UI.
  }

  return (
    <main className="flex min-h-dvh items-center bg-app-glow px-5 py-10">
      <div className="mx-auto w-full max-w-md animate-rise card-surface rounded-2xl p-6 backdrop-blur">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-moss-500">
          Alte&apos; Budgeting
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink-900">
          Set up a passkey
        </h1>
        <p className="mt-2 text-sm text-ink-600">
          Sign in next time with Face ID, Touch ID, or your device PIN — faster
          than a password, and harder to phish.
        </p>
        <PasskeySetupPanel next={nextPath} />
      </div>
    </main>
  );
}

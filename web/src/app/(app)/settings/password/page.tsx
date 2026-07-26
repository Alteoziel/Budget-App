import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PasswordResetForm } from "@/components/PasswordResetForm";
import { hasPasswordResetGrant } from "@/lib/password-reset";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = Boolean(user && (await hasPasswordResetGrant(user.id)));

  return (
    <AppShell
      title="New password"
      subtitle="Confirmed via email"
    >
      <section className="card-surface rounded-2xl p-4">
        {allowed ? (
          <>
            <p className="text-sm text-ink-600">
              Your email link was confirmed. Choose a new password below. This
              page expires in about 15 minutes.
            </p>
            <div className="mt-4">
              <PasswordResetForm />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-600">
              For security, you can only set a new password after confirming the
              link we email you. Request a fresh link from Settings, then open
              it on this device.
            </p>
            <Link
              href="/settings"
              className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-sand-50"
            >
              Back to Settings
            </Link>
          </>
        )}
      </section>
    </AppShell>
  );
}

"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function PasskeySignInButton({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const supabase = createClient();
            const { error: signInError } = await supabase.auth.signInWithPasskey();
            if (signInError) {
              setError(signInError.message);
              setPending(false);
              return;
            }
            window.location.assign(next);
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Passkey sign-in failed on this device.",
            );
            setPending(false);
          }
        }}
        className="touch-manipulation min-h-11 w-full rounded-2xl bg-moss-500 px-4 py-3.5 text-sm font-bold text-sand-50 hover:bg-moss-600 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Waiting for passkey…" : "Sign in with passkey"}
      </button>
      {error ? (
        <p className="rounded-xl bg-coral-400/15 px-3 py-2 text-sm text-coral-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}

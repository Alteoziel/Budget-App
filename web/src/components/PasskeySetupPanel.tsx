"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function PasskeySetupPanel({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-6 space-y-3">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const supabase = createClient();
            const { error: registerError } = await supabase.auth.registerPasskey();
            if (registerError) {
              setError(registerError.message);
              setPending(false);
              return;
            }
            window.location.assign(next);
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Could not create a passkey on this device.",
            );
            setPending(false);
          }
        }}
        className="touch-manipulation min-h-11 w-full rounded-2xl bg-moss-500 px-4 py-3.5 text-sm font-bold text-sand-50 hover:bg-moss-600 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Waiting for passkey…" : "Set up passkey"}
      </button>

      <Link
        href={next}
        className="flex min-h-11 touch-manipulation items-center justify-center rounded-2xl border border-ink-900/10 px-4 py-3 text-sm font-bold text-ink-700 hover:bg-ink-900/5"
      >
        Skip for now
      </Link>

      {error ? (
        <p className="rounded-xl bg-coral-400/15 px-3 py-2 text-sm text-coral-500">
          {error}
        </p>
      ) : null}

      <p className="text-xs text-ink-600">
        You can still sign in with your email and password after setting up a
        passkey.
      </p>
    </div>
  );
}

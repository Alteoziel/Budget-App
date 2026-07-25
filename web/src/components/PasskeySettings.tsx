"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

export type PasskeyRow = {
  id: string;
  friendly_name?: string | null;
  created_at: string;
  last_used_at?: string | null;
};

function formatWhen(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

export function PasskeySettings({
  initialPasskeys,
  initialError = null,
}: {
  initialPasskeys: PasskeyRow[];
  initialError?: string | null;
}) {
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>(initialPasskeys);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function refresh() {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.passkey.list();
    if (error) {
      setLoadError(error.message);
      setPasskeys([]);
      return;
    }
    setPasskeys((data ?? []) as PasskeyRow[]);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">
        Use Face ID, Touch ID, or a device PIN to sign in. If a passkey is set
        up, signing in with your password instead sends an email approval link.
      </p>

      {loadError ? (
        <p className="text-sm font-semibold text-coral-500">{loadError}</p>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-ink-600">No passkeys on this account yet.</p>
      ) : (
        <ul className="divide-y divide-ink-900/5 rounded-xl border border-ink-900/10">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm"
            >
              <div>
                <p className="font-semibold text-ink-900">
                  {passkey.friendly_name?.trim() || "Passkey"}
                </p>
                <p className="text-xs text-ink-600">
                  Added {formatWhen(passkey.created_at)}
                  {passkey.last_used_at
                    ? ` · Last used ${formatWhen(passkey.last_used_at)}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setActionError(null);
                  setActionMsg(null);
                  startTransition(async () => {
                    const supabase = createClient();
                    const { error } = await supabase.auth.passkey.delete({
                      passkeyId: passkey.id,
                    });
                    if (error) {
                      setActionError(error.message);
                      return;
                    }
                    setActionMsg("Passkey removed.");
                    await refresh();
                  });
                }}
                className="min-h-11 touch-manipulation rounded-xl border border-coral-500/40 px-3 py-2 text-xs font-bold text-coral-500 disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setActionError(null);
          setActionMsg(null);
          startTransition(async () => {
            try {
              const supabase = createClient();
              const { error } = await supabase.auth.registerPasskey();
              if (error) {
                setActionError(error.message);
                return;
              }
              setActionMsg("Passkey added.");
              await refresh();
            } catch (err) {
              setActionError(
                err instanceof Error
                  ? err.message
                  : "Could not create a passkey on this device.",
              );
            }
          });
        }}
        className="min-h-11 touch-manipulation rounded-xl bg-moss-500 px-4 py-2 text-sm font-bold text-sand-50 disabled:opacity-60"
      >
        {pending ? "Working…" : "Add passkey"}
      </button>

      {actionMsg ? (
        <p className="text-xs font-semibold text-moss-500">{actionMsg}</p>
      ) : null}
      {actionError ? (
        <p className="text-xs font-semibold text-coral-500">{actionError}</p>
      ) : null}
    </div>
  );
}

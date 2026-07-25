"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePasswordAction } from "@/lib/actions";

/** Shown only after the user confirms a password-reset email link. */
export function PasswordResetForm() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (message) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-moss-500">{message}</p>
        <Link
          href="/settings"
          className="inline-flex min-h-11 items-center rounded-xl bg-moss-500 px-4 py-2 text-sm font-bold text-sand-50"
        >
          Back to Settings
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        setMessage(null);
        setError(null);
        startTransition(async () => {
          const result = await updatePasswordAction(fd);
          if (result.ok) {
            setMessage(result.message);
            event.currentTarget.reset();
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
    >
      <label className="block text-sm font-semibold text-ink-700">
        New password
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
        />
      </label>
      <label className="block text-sm font-semibold text-ink-700">
        Confirm password
        <input
          name="password_confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 touch-manipulation rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-sand-50 disabled:opacity-60"
      >
        {pending ? "Updating…" : "Update password"}
      </button>
      {error ? (
        <p className="text-xs font-semibold text-coral-500">{error}</p>
      ) : null}
    </form>
  );
}

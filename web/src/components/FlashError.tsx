"use client";

import { useEffect, useState } from "react";

/**
 * Floating notification bubble pinned to the top of the viewport, so messages
 * no longer push the page content down.
 */
export function FlashError({
  message,
  tone = "error",
}: {
  message?: string;
  tone?: "error" | "success";
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [expired, setExpired] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setExpired(message), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message || dismissed === message || expired === message) return null;

  const isError = tone === "error";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      <div
        className={`animate-rise pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border bg-sand-50 px-4 py-3 shadow-soft ${
          isError ? "border-coral-500/35" : "border-moss-500/35"
        }`}
      >
        <span
          aria-hidden
          className={`mt-0.5 text-base font-bold leading-none ${
            isError ? "text-coral-500" : "text-moss-500"
          }`}
        >
          {isError ? "!" : "✓"}
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink-900">{message}</p>
        <button
          type="button"
          onClick={() => setDismissed(message)}
          aria-label="Dismiss notification"
          className="-mr-1 -mt-1 shrink-0 rounded-lg px-2 py-1 text-sm font-bold text-ink-500 hover:bg-sand-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

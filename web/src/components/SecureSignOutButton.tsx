"use client";

import { useTransition } from "react";
import { signOutAction } from "@/lib/actions";
import { purgePrivateOfflineData } from "@/lib/offline/db";

export function SecureSignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          try {
            await purgePrivateOfflineData();
          } finally {
            await signOutAction();
          }
        });
      }}
      className="rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-sand-50 hover:bg-ink-800 disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

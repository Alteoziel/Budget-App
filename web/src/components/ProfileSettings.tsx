"use client";

import { useState, useTransition } from "react";
import {
  updateDisplayNameAction,
  updatePasswordAction,
} from "@/lib/actions";

export function ProfileSettings({
  email,
  displayName,
}: {
  email: string;
  displayName: string;
}) {
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [passMsg, setPassMsg] = useState<string | null>(null);
  const [passErr, setPassErr] = useState<string | null>(null);
  const [namePending, startName] = useTransition();
  const [passPending, startPass] = useTransition();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-600">Email</p>
        <p className="mt-1 text-sm font-semibold text-ink-900">{email || "—"}</p>
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setNameMsg(null);
          setNameErr(null);
          startName(async () => {
            const result = await updateDisplayNameAction(fd);
            if (result.ok) setNameMsg(result.message);
            else setNameErr(result.error);
          });
        }}
      >
        <label className="block text-sm font-semibold text-ink-700">
          Display name
          <input
            name="display_name"
            defaultValue={displayName}
            required
            maxLength={80}
            className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
          />
        </label>
        <button
          type="submit"
          disabled={namePending}
          className="min-h-11 touch-manipulation rounded-xl bg-moss-500 px-4 py-2 text-sm font-bold text-sand-50 disabled:opacity-60"
        >
          {namePending ? "Saving…" : "Save name"}
        </button>
        {nameMsg ? <p className="text-xs font-semibold text-moss-500">{nameMsg}</p> : null}
        {nameErr ? <p className="text-xs font-semibold text-coral-500">{nameErr}</p> : null}
      </form>

      <form
        className="space-y-3 border-t border-ink-900/5 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setPassMsg(null);
          setPassErr(null);
          startPass(async () => {
            const result = await updatePasswordAction(fd);
            if (result.ok) {
              setPassMsg(result.message);
              e.currentTarget.reset();
            } else setPassErr(result.error);
          });
        }}
      >
        <h3 className="text-sm font-bold text-ink-900">Change password</h3>
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
          disabled={passPending}
          className="min-h-11 touch-manipulation rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-sand-50 disabled:opacity-60"
        >
          {passPending ? "Updating…" : "Update password"}
        </button>
        {passMsg ? <p className="text-xs font-semibold text-moss-500">{passMsg}</p> : null}
        {passErr ? <p className="text-xs font-semibold text-coral-500">{passErr}</p> : null}
      </form>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import {
  requestPasswordResetAction,
  updateDisplayNameAction,
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

      <div className="space-y-3 border-t border-ink-900/5 pt-4">
        <h3 className="text-sm font-bold text-ink-900">Change password</h3>
        <p className="text-sm text-ink-600">
          For security, we email a confirmation link to{" "}
          <span className="font-semibold text-ink-800">{email || "your address"}</span>
          . Open that link to choose a new password — you can’t change it
          directly in the app.
        </p>
        <button
          type="button"
          disabled={passPending || !email}
          onClick={() => {
            setPassMsg(null);
            setPassErr(null);
            startPass(async () => {
              const result = await requestPasswordResetAction();
              if (result.ok) setPassMsg(result.message);
              else setPassErr(result.error);
            });
          }}
          className="min-h-11 touch-manipulation rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-sand-50 disabled:opacity-60"
        >
          {passPending ? "Sending…" : "Email me a confirmation link"}
        </button>
        {passMsg ? <p className="text-xs font-semibold text-moss-500">{passMsg}</p> : null}
        {passErr ? <p className="text-xs font-semibold text-coral-500">{passErr}</p> : null}
      </div>
    </div>
  );
}

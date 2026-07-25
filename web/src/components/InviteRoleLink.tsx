"use client";

import { useState, useTransition } from "react";
import { generateRoleInviteAction } from "@/lib/actions";

const ROLES = ["viewer", "editor", "admin", "owner"] as const;

async function shareInvite(url: string, role: string) {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "Alte' Budgeting invite",
        text: `Join my budget as ${role}`,
        url,
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function InviteRoleLink({
  canInviteOwner = false,
}: {
  canInviteOwner?: boolean;
}) {
  const [role, setRole] = useState<(typeof ROLES)[number]>("editor");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function generate() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await generateRoleInviteAction(role);
      if (!result.ok) {
        setInviteUrl(null);
        setError(result.error);
        return;
      }
      setInviteUrl(result.url);
      await shareInvite(result.url, result.role);
    });
  }

  async function copyLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setError("Could not copy — select the link manually.");
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-ink-700">
        Role
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm"
        >
          {ROLES.filter((r) => canInviteOwner || r !== "owner").map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={generate}
        disabled={pending}
        className="min-h-11 w-full touch-manipulation rounded-2xl bg-moss-500 px-4 py-3 text-sm font-bold text-sand-50 disabled:opacity-60"
      >
        {pending ? "Generating…" : "Generate role invite link"}
      </button>
      <p className="text-xs text-ink-600">
        Unlimited uses. On iPhone, Share opens after the link is created.
      </p>
      {error ? <p className="text-xs font-semibold text-coral-500">{error}</p> : null}
      {inviteUrl ? (
        <div className="space-y-2 rounded-2xl bg-moss-500/10 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-600">
            Invite link
          </p>
          <p className="break-all font-mono text-xs text-ink-900">{inviteUrl}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyLink()}
              className="min-h-11 touch-manipulation rounded-xl bg-ink-900 px-3 py-2 text-xs font-bold text-sand-50"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => void shareInvite(inviteUrl, role).then((shared) => {
                if (!shared) void copyLink();
              })}
              className="min-h-11 touch-manipulation rounded-xl bg-moss-500 px-3 py-2 text-xs font-bold text-sand-50"
            >
              Share…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

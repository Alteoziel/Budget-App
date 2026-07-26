"use client";

import { useState, useTransition } from "react";
import { submitFeedbackAction } from "@/lib/actions";

const KINDS = [
  { value: "feedback", label: "General feedback" },
  { value: "request", label: "Feature request" },
  { value: "bug", label: "Bug report" },
] as const;

export function FeedbackSettings() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        setMessage(null);
        setError(null);
        startTransition(async () => {
          const result = await submitFeedbackAction(fd);
          if (result.ok) {
            setMessage(result.message);
            form.reset();
          } else {
            setError(result.error);
          }
        });
      }}
    >
      <label className="block text-sm font-semibold text-ink-700">
        Type
        <select
          name="kind"
          defaultValue="feedback"
          className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
        >
          {KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-semibold text-ink-700">
        Message
        <textarea
          name="message"
          required
          minLength={3}
          maxLength={4000}
          rows={4}
          placeholder="What should we improve, add, or fix?"
          className="mt-1 w-full touch-manipulation resize-y rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 touch-manipulation rounded-xl bg-moss-500 px-4 py-2 text-sm font-bold text-sand-50 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send feedback"}
      </button>

      {message ? (
        <p className="text-xs font-semibold text-moss-500">{message}</p>
      ) : null}
      {error ? (
        <p className="text-xs font-semibold text-coral-500">{error}</p>
      ) : null}
    </form>
  );
}

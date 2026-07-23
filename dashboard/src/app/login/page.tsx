"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.includes("\\") || raw.includes("\0")) return "/";
  if (!/^\/[A-Za-z0-9._~/-]*$/.test(raw)) return "/";
  if (raw.startsWith("/login")) return "/";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(
    () => safeNextPath(searchParams.get("next")),
    [searchParams],
  );

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!res.ok) {
        setError(data.message || "Incorrect password.");
        setPending(false);
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Could not reach the login service.");
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
      <p className="text-xs uppercase tracking-[0.25em] text-mist">
        Budget App
      </p>
      <h1 className="mt-3 font-display text-4xl text-white">Sign in</h1>
      <p className="mt-3 text-mist">
        This review panel is password-gated. Sessions last 7 days on this
        browser, then you sign in again.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block text-sm text-mist">
          Site password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-white outline-none ring-signal focus:ring-2"
          />
        </label>

        {error ? (
          <p className="text-sm text-alert" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || !password}
          className="w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-[#04140f] transition enabled:hover:brightness-110 disabled:opacity-50"
        >
          {pending ? "Checking…" : "Continue"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-md py-20 text-mist">Loading…</main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

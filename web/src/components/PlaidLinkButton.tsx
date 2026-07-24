"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";

export function PlaidLinkButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/plaid/link-token", { method: "POST" });
        const data = (await res.json()) as { link_token?: string; error?: string };
        if (!res.ok) throw new Error(data.error || "Could not start Plaid Link.");
        if (!cancelled) setLinkToken(data.link_token ?? null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not start Plaid Link.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSuccess = useCallback(
    async (
      public_token: string,
      metadata: { institution?: { institution_id: string; name: string } | null },
    ) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            public_token,
            institution: metadata.institution ?? null,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || "Could not link bank.");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not link bank.");
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={disabled || busy || !ready || !linkToken}
        onClick={() => open()}
        className="w-full rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 disabled:opacity-50"
      >
        {busy ? "Linking…" : ready && linkToken ? "Connect bank" : "Loading Plaid…"}
      </button>
      {error ? <p className="text-xs font-semibold text-coral-500">{error}</p> : null}
    </div>
  );
}

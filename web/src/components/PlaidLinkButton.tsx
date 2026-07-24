"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";

export function PlaidLinkButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingToken, setLoadingToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingOpenRef = useRef(false);

  const fetchLinkToken = useCallback(async (): Promise<string | null> => {
    setLoadingToken(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      const data = (await res.json()) as { link_token?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not start Plaid Link.");
      const token = data.link_token ?? null;
      setLinkToken(token);
      return token;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Plaid Link.");
      setLinkToken(null);
      return null;
    } finally {
      setLoadingToken(false);
    }
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
        setLinkToken(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not link bank.");
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const onExit = useCallback(
    (err: { error_message?: string; display_message?: string } | null) => {
      if (err?.display_message || err?.error_message) {
        setError(err.display_message || err.error_message || "Plaid Link closed.");
      }
      // Token may be single-use / expired after exit — clear for next attempt.
      setLinkToken(null);
    },
    [],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit,
  });

  useEffect(() => {
    if (pendingOpenRef.current && ready && linkToken) {
      pendingOpenRef.current = false;
      open();
    }
  }, [ready, linkToken, open]);

  async function handleClick() {
    setError(null);
    if (ready && linkToken) {
      open();
      return;
    }
    pendingOpenRef.current = true;
    const token = linkToken ?? (await fetchLinkToken());
    if (!token) {
      pendingOpenRef.current = false;
    }
  }

  const label = busy ? "Linking…" : loadingToken ? "Loading Plaid…" : "Connect bank";

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={disabled || busy || loadingToken}
        onClick={() => void handleClick()}
        className="min-h-11 w-full touch-manipulation rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 disabled:opacity-50"
      >
        {label}
      </button>
      {error ? <p className="text-xs font-semibold text-coral-500">{error}</p> : null}
    </div>
  );
}

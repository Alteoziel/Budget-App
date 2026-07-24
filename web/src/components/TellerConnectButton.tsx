"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

declare global {
  interface Window {
    TellerConnect?: {
      setup: (config: {
        applicationId: string;
        environment?: string;
        products?: string[];
        onSuccess: (enrollment: {
          accessToken: string;
          enrollment: { id: string; institution?: { name?: string } };
        }) => void;
        onExit?: () => void;
      }) => { open: () => void };
    };
  }
}

type Props = {
  applicationId: string;
  environment: string;
  disabled?: boolean;
};

export function TellerConnectButton({
  applicationId,
  environment,
  disabled,
}: Props) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!applicationId) return;
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-teller-connect="1"]',
    );
    if (existing && window.TellerConnect) {
      setReady(true);
      return;
    }
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = "https://cdn.teller.io/connect/connect.js";
      script.async = true;
      script.dataset.tellerConnect = "1";
      document.body.appendChild(script);
    }
    const onLoad = () => setReady(Boolean(window.TellerConnect));
    script.addEventListener("load", onLoad);
    if (window.TellerConnect) setReady(true);
    return () => script.removeEventListener("load", onLoad);
  }, [applicationId]);

  async function openConnect() {
    setError(null);
    if (!window.TellerConnect || !applicationId) {
      setError("Teller Connect is not available.");
      return;
    }
    const instance = window.TellerConnect.setup({
      applicationId,
      environment,
      products: ["transactions", "balance"],
      onSuccess: async (enrollment) => {
        setBusy(true);
        try {
          const res = await fetch("/api/teller/enroll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: enrollment.accessToken,
              enrollment: enrollment.enrollment,
            }),
          });
          const data = (await res.json()) as { error?: string };
          if (!res.ok) throw new Error(data.error || "Could not save bank link.");
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Connect failed.");
        } finally {
          setBusy(false);
        }
      },
      onExit: () => setBusy(false),
    });
    instance.open();
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={disabled || busy || !ready || !applicationId}
        onClick={openConnect}
        className="w-full rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 disabled:opacity-50"
      >
        {busy ? "Linking…" : ready ? "Connect bank" : "Loading Connect…"}
      </button>
      {error ? <p className="text-xs font-semibold text-coral-500">{error}</p> : null}
    </div>
  );
}

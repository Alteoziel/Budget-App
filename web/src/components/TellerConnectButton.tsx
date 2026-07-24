"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore, useState } from "react";

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

let tellerScriptPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribeTellerReady(cb: () => void) {
  listeners.add(cb);
  ensureTellerScript();
  return () => listeners.delete(cb);
}

function getTellerReadySnapshot() {
  return Boolean(typeof window !== "undefined" && window.TellerConnect);
}

function getTellerReadyServerSnapshot() {
  return false;
}

function notifyReady() {
  for (const cb of listeners) cb();
}

function ensureTellerScript() {
  if (typeof window === "undefined") return;
  if (window.TellerConnect) {
    notifyReady();
    return;
  }
  if (tellerScriptPromise) return;

  tellerScriptPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-teller-connect="1"]',
    );
    if (existing) {
      existing.addEventListener("load", () => {
        notifyReady();
        resolve();
      });
      if (window.TellerConnect) {
        notifyReady();
        resolve();
      }
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.teller.io/connect/connect.js";
    script.async = true;
    script.dataset.tellerConnect = "1";
    script.onload = () => {
      notifyReady();
      resolve();
    };
    script.onerror = () => resolve();
    document.body.appendChild(script);
  });
}

export function TellerConnectButton({
  applicationId,
  environment,
  disabled,
}: Props) {
  const router = useRouter();
  const ready = useSyncExternalStore(
    subscribeTellerReady,
    getTellerReadySnapshot,
    getTellerReadyServerSnapshot,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openConnect() {
    setError(null);
    ensureTellerScript();
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

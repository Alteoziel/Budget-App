"use client";

import { OfflineBanner } from "@/components/OfflineBanner";
import { OfflineProvider } from "@/components/OfflineProvider";

/** Client wrapper so authenticated pages share one offline cache/outbox. */
export function AppOfflineShell({ children }: { children: React.ReactNode }) {
  return (
    <OfflineProvider>
      <OfflineBanner />
      {children}
    </OfflineProvider>
  );
}

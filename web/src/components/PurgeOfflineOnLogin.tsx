"use client";

import { useEffect } from "react";
import { purgePrivateOfflineData } from "@/lib/offline/db";

/**
 * Clears cached private page HTML / IndexedDB when the login screen mounts.
 * The service worker no longer intercepts /login (auth redirects must stay
 * browser-native), so purge happens here instead of in the SW fetch handler.
 */
export function PurgeOfflineOnLogin() {
  useEffect(() => {
    void purgePrivateOfflineData();
  }, []);

  return null;
}

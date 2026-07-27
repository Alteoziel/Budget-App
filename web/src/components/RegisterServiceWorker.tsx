"use client";

import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Intentionally do NOT reload on controllerchange. A forced reload on app
    // open (when a new SW skipWaiting + claims) re-opens a white WKWebView gap
    // for ~0.5s. New workers take effect on the next cold start / navigation.

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        const requestSkipWaiting = () => {
          if (registration.waiting) {
            registration.waiting.postMessage("SKIP_WAITING");
          }
        };

        if (registration.waiting) requestSkipWaiting();
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed") requestSkipWaiting();
          });
        });

        // Check for updates when the app is opened / focused — without reload.
        void registration.update();
        const onFocus = () => {
          void registration.update();
        };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void registration.update();
        });
      })
      .catch(() => {
        // Ignore registration failures in unsupported contexts.
      });
  }, []);

  return null;
}

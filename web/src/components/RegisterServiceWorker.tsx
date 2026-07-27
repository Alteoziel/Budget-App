"use client";

import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let refreshing = false;

    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      // Pick up a new SW after install so offline assets stay current.
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

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

        // Check for updates when the app is opened / focused.
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

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  return null;
}

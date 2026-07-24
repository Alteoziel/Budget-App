/* Alte' Budgeting service worker — offline shell + last-visited pages. */
const VERSION = "v6";
const STATIC_CACHE = `alte-static-${VERSION}`;
const PAGE_CACHE = `alte-pages-${VERSION}`;
const DATA_CACHE = `alte-data-${VERSION}`;

const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

const APP_SHELL_PATHS = [
  "/budget",
  "/accounts",
  "/insights",
  "/import",
  "/settings",
  "/offline",
  "/login",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith("alte-") &&
              key !== STATIC_CACHE &&
              key !== PAGE_CACHE &&
              key !== DATA_CACHE,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/sw.js" ||
    url.pathname === "/offline.html"
  );
}

function isNavigation(request) {
  return request.mode === "navigate" ||
    (request.method === "GET" &&
      request.headers.get("accept")?.includes("text/html"));
}

function isOfflineSnapshot(url) {
  return url.pathname === "/api/offline/snapshot";
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const url = new URL(request.url);
      // Cache authenticated app pages so they reopen offline.
      if (
        APP_SHELL_PATHS.some(
          (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
        )
      ) {
        await cache.put(request, response.clone());
      }
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Try a bare path match (ignore search params).
    const url = new URL(request.url);
    const bare = await cache.match(url.pathname);
    if (bare) return bare;

    const offline = await caches.match("/offline.html");
    return (
      offline ||
      new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      })
    );
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (
      (await caches.match(request)) ||
      new Response("", { status: 504, statusText: "Offline" })
    );
  }
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ offline: true, error: "Offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;

  // Never let the SW itself be stale forever.
  if (url.pathname === "/sw.js") {
    event.respondWith(fetch(request));
    return;
  }

  if (isOfflineSnapshot(url)) {
    event.respondWith(networkFirstData(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }

  if (isNavigation(request)) {
    event.respondWith(networkFirstPage(request));
  }
});

/* Alte' Budgeting service worker — offline shell + last-visited pages. */
const VERSION = "v9";
const STATIC_CACHE = `alte-static-${VERSION}`;
const PAGE_CACHE = `alte-pages-${VERSION}`;
const PRIVATE_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

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
              key !== PAGE_CACHE,
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
  if (event.data === "PURGE_PRIVATE_DATA") {
    event.waitUntil(purgePrivateData());
  }
});

async function purgePrivateData() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter(
        (key) =>
          key.startsWith("alte-pages-") || key.startsWith("alte-data-"),
      )
      .map((key) => caches.delete(key)),
  );
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("alte-offline");
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/splash/") ||
    url.pathname === "/sw.js" ||
    url.pathname === "/offline.html"
  );
}

function isManifest(url) {
  return url.pathname === "/manifest.webmanifest";
}

function isNavigation(request) {
  return request.mode === "navigate" ||
    (request.method === "GET" &&
      request.headers.get("accept")?.includes("text/html"));
}

function isOfflineSnapshot(url) {
  return url.pathname === "/api/offline/snapshot";
}

async function freshCachedPage(cache, request) {
  const cached = await cache.match(request);
  if (!cached) return null;
  const cachedAt = Number(cached.headers.get("x-alte-cached-at") || "0");
  const reauthRaw = cached.headers.get("x-alte-reauth-expires");
  const reauthExpiresAt = reauthRaw == null ? null : Number(reauthRaw);
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) {
    await cache.delete(request);
    return null;
  }
  if (Date.now() - cachedAt >= PRIVATE_CACHE_MAX_AGE_MS) {
    await cache.delete(request);
    return null;
  }
  // Only enforce reauth expiry when the header was explicitly stamped.
  if (
    reauthExpiresAt != null &&
    Number.isFinite(reauthExpiresAt) &&
    reauthExpiresAt > 0 &&
    reauthExpiresAt <= Date.now()
  ) {
    await cache.delete(request);
    return null;
  }
  return cached;
}

async function putPageCache(cache, request, response) {
  const url = new URL(request.url);
  if (
    !APP_SHELL_PATHS.some(
      (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
    )
  ) {
    return;
  }
  const headers = new Headers(response.headers);
  const now = Date.now();
  headers.set("x-alte-cached-at", String(now));
  headers.set("x-alte-reauth-expires", String(now + PRIVATE_CACHE_MAX_AGE_MS));
  const cachedResponse = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  await cache.put(request, cachedResponse);
}

/**
 * Paint a warm cache immediately on cold start, then refresh in the background.
 * Network-first left a white gap while waiting for HTML after the OS splash.
 */
async function staleWhileRevalidatePage(request) {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === "/login") {
    await purgePrivateData();
  }
  const cache = await caches.open(PAGE_CACHE);
  const cached = await freshCachedPage(cache, request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await putPageCache(cache, request, response);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    void networkPromise;
    return cached;
  }

  const network = await networkPromise;
  if (network) return network;

  const url = new URL(request.url);
  const bare = await freshCachedPage(cache, url.pathname);
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

async function networkFirstManifest(request) {
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
      new Response("{}", {
        status: 504,
        headers: { "Content-Type": "application/manifest+json" },
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
    event.respondWith(fetch(request));
    return;
  }

  // Always prefer a fresh splash/theme color over a cached light manifest.
  if (isManifest(url)) {
    event.respondWith(networkFirstManifest(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }

  if (isNavigation(request)) {
    event.respondWith(staleWhileRevalidatePage(request));
  }
});

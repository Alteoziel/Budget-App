/* Alte' Budgeting service worker — offline shell + last-visited pages. */
<<<<<<< HEAD
const VERSION = "v9";
=======
const VERSION = "v10";
>>>>>>> origin/main
const STATIC_CACHE = `alte-static-${VERSION}`;
const PAGE_CACHE = `alte-pages-${VERSION}`;
const PRIVATE_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const PRECACHE = [
  "/offline.html",
  "/boot.html",
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
      // Keep last-visited HTML across SW bumps so cold open stays a cache hit.
      await migratePageCacheForward();

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
  // Reject cross-origin postMessage (CodeQL js/missing-origin-check).
  // Same-origin app pages post SKIP_WAITING / PURGE_PRIVATE_DATA only.
  if (event.origin !== self.location.origin) {
    return;
  }
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data === "PURGE_PRIVATE_DATA") {
    event.waitUntil(purgePrivateData());
  }
});

async function migratePageCacheForward() {
  const keys = await caches.keys();
  const oldPageCaches = keys
    .filter((key) => key.startsWith("alte-pages-") && key !== PAGE_CACHE)
    .sort();
  if (oldPageCaches.length === 0) return;

  const next = await caches.open(PAGE_CACHE);
  for (const oldKey of oldPageCaches) {
    const prev = await caches.open(oldKey);
    const requests = await prev.keys();
    await Promise.all(
      requests.map(async (request) => {
        if (await next.match(request)) return;
        const response = await prev.match(request);
        if (response) await next.put(request, response);
      }),
    );
  }
}

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
    url.pathname === "/offline.html" ||
    url.pathname === "/boot.html"
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

function isBootFetch(request) {
  return request.headers.get("X-Alte-Boot") === "1";
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
  // Drop CSP from the cached copy? Keep it — needed when serving cached HTML.
  const cachedResponse = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  await cache.put(request, cachedResponse);
  // Also store under pathname for bare matches (querystring variants).
  if (url.search) {
    await cache.put(url.pathname, cachedResponse.clone());
  }
}

/**
 * Instant dark document for cache-miss navigations. The page then fetches the
 * real HTML (X-Alte-Boot) and location.replace()s so the WebView never sits on
 * the default white background while the network is in flight (~0.5s).
 */
async function darkBootNavigationResponse() {
  const cached = await caches.match("/boot.html");
  if (cached) {
    return new Response(await cached.blob(), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Alte-Boot-Shell": "1",
      },
    });
  }
  return new Response(
    `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><meta name="theme-color" content="#080c0b"/><meta name="color-scheme" content="dark"/><title>Alte' Budgeting</title><style>html,body{margin:0;min-height:100%;background:#080c0b;color-scheme:dark}</style></head><body style="background:#080c0b"></body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Alte-Boot-Shell": "1",
      },
    },
  );
}

/**
 * Paint a warm cache immediately on cold start, then refresh in the background.
 * On cache miss, paint a dark boot shell immediately instead of waiting on the
 * network (which leaves a white WKWebView gap after the OS splash).
 */
async function staleWhileRevalidatePage(request) {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === "/login") {
    await purgePrivateData();
  }
  const cache = await caches.open(PAGE_CACHE);
  const cached = await freshCachedPage(cache, request);
  const bootFetch = isBootFetch(request);

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

  // Boot fetch must hit the network (and warm the page cache) — never recurse
  // into another dark shell.
  if (bootFetch) {
    const network = await networkPromise;
    if (network) return network;
    const bare = await freshCachedPage(cache, requestUrl.pathname);
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

  // Real navigation, cache miss: never block on the network behind a white
  // WebView. Hand back the dark boot page; it will fetch + replace.
  if (request.mode === "navigate") {
    void networkPromise;
    return darkBootNavigationResponse();
  }

  const network = await networkPromise;
  if (network) return network;

  const bare = await freshCachedPage(cache, requestUrl.pathname);
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

  if (isNavigation(request) || isBootFetch(request)) {
    event.respondWith(staleWhileRevalidatePage(request));
  }
});

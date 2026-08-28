/* Alte' Budgeting service worker — offline shell + last-visited pages. */
const VERSION = "v13";
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
  "/transactions",
  "/import",
  "/settings",
  "/offline",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Fetch each asset separately. cache.addAll() aborts the whole install
      // if one URL 307s (auth used to redirect /boot.html → /login).
      await Promise.all(
        PRECACHE.map(async (path) => {
          try {
            const response = await fetch(path, { cache: "reload" });
            if (response.ok && !response.redirected) {
              await cache.put(path, response);
            }
          } catch {
            // Skip missing/redirected files so the worker still activates.
          }
        }),
      );
      await self.skipWaiting();
    })(),
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
        if (!response || response.redirected) return;
        try {
          await next.put(request, await cloneWithoutRedirect(response));
        } catch {
          // Skip entries Safari/Chrome reject (e.g. leftover redirected copies).
        }
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

/**
 * Auth/session routes issue HTTP redirects (login ↔ budget, passkey setup,
 * magic-link callback). Safari rejects SW-fulfilled navigations that carry
 * redirect metadata ("Response served by service worker has redirections").
 * Let the browser handle these natively.
 */
function isAuthPath(url) {
  const path = url.pathname;
  return (
    path === "/login" ||
    path.startsWith("/login/") ||
    path === "/passkey-setup" ||
    path.startsWith("/passkey-setup/") ||
    path.startsWith("/auth/") ||
    path.startsWith("/invite/") ||
    // Let the browser load these as real files. Serving a cached /boot.html
    // for another URL makes Chrome navigate to /boot.html and ERR_FAILED.
    path === "/boot.html" ||
    path === "/offline.html"
  );
}

/**
 * Strip redirect metadata so the response can fulfill navigation requests
 * (redirect mode "manual") in Safari/Chrome.
 */
async function cloneWithoutRedirect(response) {
  const cloned = response.clone();
  const body = "body" in cloned ? cloned.body : await cloned.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function navigationSafeResponse(request, response) {
  if (!response) return response;
  // Opaque redirects (manual mode) — synthesize a real redirect response.
  if (response.type === "opaqueredirect" || response.status === 0) {
    return Response.redirect(request.url, 302);
  }
  if (response.redirected || request.redirect === "manual") {
    return cloneWithoutRedirect(response);
  }
  return response;
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
  return cloneWithoutRedirect(cached);
}

async function putPageCache(cache, request, response) {
  if (!response || !response.ok || response.redirected) {
    return;
  }
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
 * Instant dark document for cache-miss navigations. Built as a *synthetic*
 * Response (empty URL) so Chrome/Safari cannot treat it as a redirect to
 * /boot.html — that produced ERR_FAILED after password/passkey sign-in.
 * The page then fetches the real HTML (X-Alte-Boot) and writes it in-place.
 */
const BOOT_SHELL_HTML = `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#080c0b" />
    <title>Alte' Budgeting</title>
    <style>html,body{margin:0;min-height:100%;background:#080c0b!important;color-scheme:dark}</style>
  </head>
  <body style="background:#080c0b">
    <script>
      (async function () {
        var path = location.pathname;
        if (path === "/boot.html" || path === "/offline.html") {
          try { sessionStorage.removeItem("alte-boot-lock"); } catch (e) {}
          location.replace("/budget");
          return;
        }
        var url = location.href;
        var lockKey = "alte-boot-lock";
        try {
          if (sessionStorage.getItem(lockKey) === url) {
            sessionStorage.removeItem(lockKey);
            location.replace("/offline.html");
            return;
          }
          sessionStorage.setItem(lockKey, url);
          var res = await fetch(url, {
            credentials: "same-origin",
            cache: "reload",
            redirect: "follow",
            headers: { Accept: "text/html", "X-Alte-Boot": "1" },
          });
          if (!res.ok) throw new Error("boot fetch failed");
          if (res.redirected && res.url && res.url !== url) {
            sessionStorage.removeItem(lockKey);
            location.replace(res.url);
            return;
          }
          var html = await res.text();
          sessionStorage.removeItem(lockKey);
          document.open();
          document.write(html);
          document.close();
        } catch (e) {
          sessionStorage.removeItem(lockKey);
          location.replace("/offline.html");
        }
      })();
    </script>
  </body>
</html>`;

function darkBootNavigationResponse() {
  return new Response(BOOT_SHELL_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Alte-Boot-Shell": "1",
    },
  });
}

/**
 * Rebuild navigation requests before fetch(). Following a POST→redirect with
 * the original navigation Request can confuse some WebViews; a clean GET
 * with redirect:"follow" plus cloneWithoutRedirect keeps Safari happy.
 */
function networkPageRequest(request) {
  if (request.mode !== "navigate" && !isBootFetch(request)) {
    return request;
  }
  const headers = new Headers(request.headers);
  return new Request(request.url, {
    method: "GET",
    headers,
    mode: "same-origin",
    credentials: request.credentials === "omit" ? "omit" : "same-origin",
    cache: request.cache,
    redirect: "follow",
  });
}

/**
 * Paint a warm cache immediately on cold start, then refresh in the background.
 * On cache miss, paint a dark boot shell immediately instead of waiting on the
 * network (which leaves a white WKWebView gap after the OS splash).
 */
async function staleWhileRevalidatePage(request) {
  const requestUrl = new URL(request.url);
  const cache = await caches.open(PAGE_CACHE);
  const cached = await freshCachedPage(cache, request);
  const bootFetch = isBootFetch(request);

  const networkPromise = fetch(networkPageRequest(request))
    .then(async (response) => {
      if (response && response.ok && !response.redirected) {
        try {
          await putPageCache(cache, request, response);
        } catch {
          // Caching must never fail the navigation / boot fetch.
        }
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
    if (network) {
      // If auth middleware redirected (e.g. session expired → /login), hand the
      // final URL to the boot shell via a synthetic redirect response.
      if (network.redirected) {
        return Response.redirect(network.url, 302);
      }
      return network;
    }
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
  if (network) {
    return navigationSafeResponse(request, network);
  }

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
    if (response && response.ok && !response.redirected) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, await cloneWithoutRedirect(response));
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
  if (cached && !cached.redirected) {
    return cloneWithoutRedirect(cached);
  }
  try {
    const response = await fetch(request);
    if (response && response.ok && !response.redirected) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, await cloneWithoutRedirect(response));
      return response;
    }
    // Redirected responses cannot fulfill navigations (Chrome ERR_FAILED /
    // Safari "Response served by service worker has redirections").
    if (
      request.mode === "navigate" &&
      response &&
      (response.redirected || response.type === "opaqueredirect")
    ) {
      return darkBootNavigationResponse();
    }
    if (response && !response.redirected) return response;
  } catch {
    // fall through to cache / empty 504
  }
  return (
    (cached && !cached.redirected ? cached : null) ||
    new Response("", { status: 504, statusText: "Offline" })
  );
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

  // Password / passkey / invite / magic-link / boot+offline shells. Bypass so
  // Safari/Chrome do not fail navigations that 307 (ERR_FAILED / "has redirections").
  if (isAuthPath(url)) {
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

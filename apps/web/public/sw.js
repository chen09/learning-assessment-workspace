const CACHE_NAME = "luma-shell-v2";
const APP_ASSETS = ["/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.pathname.includes("/v1/") ||
    url.hostname.endsWith("supabase.co")
  ) {
    return;
  }

  // Learning data is always fetched by the API, but every static route also
  // contains an initial page shell. Do not pin that shell forever: a child
  // returning to a worksheet must receive the current client bundle and UI.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)),
            );
          }
          return response;
        })
        .catch(async () => {
          return (await caches.match(request)) || (await caches.match("/"));
        }),
    );
    return;
  }

  // Next's RSC/navigation payloads are stateful and must never be cached.
  if (url.searchParams.has("_rsc")) {
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:css|js|svg|png|jpg|jpeg|webp|woff2?)$/i.test(url.pathname);

  if (!isStaticAsset) {
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)),
            );
          }
          return response;
        }),
    ),
  );
});

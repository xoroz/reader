// Reader service worker — offline-first for shell & book content
const VERSION = "reader-v12-20260419-id";
const SHELL_CACHE = `${VERSION}-shell`;
const BOOK_CACHE = `${VERSION}-books`;
const BP = "/Reader";

const SHELL_URLS = [
  `${BP}/`,
  `${BP}/manifest.webmanifest`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!url.pathname.startsWith(BP)) return;
  if (url.pathname.startsWith(`${BP}/api/auth`)) return;

  // Book API & page routes — stale-while-revalidate into BOOK_CACHE
  const isBookApi = url.pathname.startsWith(`${BP}/api/books/`);
  const isBookPage = /^\/Reader\/book\/[^/]+$/.test(url.pathname);
  const isLibraryRoot = url.pathname === `${BP}` || url.pathname === `${BP}/`;
  const isStatic = url.pathname.startsWith(`${BP}/_next/static/`) || url.pathname.match(/\.(css|js|woff2?|png|svg|webmanifest)$/);

  // Book pages: network-first to avoid hydration mismatches when JS chunks change between builds.
  // Book API: stale-while-revalidate for offline reading.
  if (isBookPage) {
    event.respondWith(networkFirst(req, BOOK_CACHE));
    return;
  }
  if (isBookApi) {
    event.respondWith(staleWhileRevalidate(req, BOOK_CACHE));
    return;
  }
  if (isStatic) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }
  if (isLibraryRoot) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || new Response("Offline", { status: 503 });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req).catch(() => null);
  if (res && res.ok) cache.put(req, res.clone());
  return res || new Response("Offline", { status: 503 });
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    return cached || new Response("Offline", { status: 503 });
  }
}

// Allow a message-driven precache of a specific book's chapters
self.addEventListener("message", async (event) => {
  const { type, bookId } = event.data || {};
  if (type === "precache-book" && bookId) {
    const cache = await caches.open(BOOK_CACHE);
    const urls = [`${BP}/book/${bookId}`, `${BP}/api/books/${bookId}`];
    for (const u of urls) {
      try {
        const res = await fetch(u, { credentials: "include" });
        if (res.ok) await cache.put(u, res.clone());
      } catch {}
    }
  }
});

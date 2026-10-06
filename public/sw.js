/**
 * UltraLink PWA Service Worker
 * Precaches app shell, core pages, and AudioWorklet processor for 100% offline acoustic operation.
 */

const CACHE_NAME = 'ultralink-core-v1';

const STATIC_ASSETS = [
  '/',
  '/transmit',
  '/receive-file',
  '/live-listen',
  '/history',
  '/diagnostics',
  '/manifest.webmanifest',
  '/worklets/ultralink-decoder-worklet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[UltraLink SW] Asset caching note for:', asset, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. AudioWorklet & Static Scripts: Cache-First
  if (url.pathname.startsWith('/worklets/') || url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return (
          cached ||
          fetch(event.request).then((response) => {
            if (response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
        );
      })
    );
    return;
  }

  // 2. Navigation & App Shell: Network-first falling back to Cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return (
          caches.match(event.request) ||
          caches.match('/transmit') ||
          caches.match('/')
        );
      })
    );
    return;
  }

  // 3. General static requests: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

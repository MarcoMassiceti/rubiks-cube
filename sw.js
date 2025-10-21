// Bump CACHE_NAME to force old caches to be dropped.
const CACHE_NAME = 'rubik-pwa-v3-2025-10-21';
const ASSETS = [
  './',
  './index.html?v=6',
  './style.css?v=6',
  './app.js?v=6',
  './cube.js?v=6',
  './manifest.webmanifest?v=6',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/three@0.160.0/build/three.min.js'
];

// Take control ASAP on update
self.addEventListener('install', (e) => {
  self.skipWaiting(); // new SW becomes active immediately
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Remove old caches
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
      await self.clients.claim(); // control existing clients immediately
    })()
  );
});

// Network-first strategy with cache fallback.
// Also respect explicit cache-busting queries (?v=..., ?dev=1).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // If user appended ?dev=1, always go to network and don't cache
  if (url.searchParams.get('dev') === '1') {
    e.respondWith(fetch(e.request, { cache: 'reload' }).catch(() => caches.match(e.request)));
    return;
  }

  // For versioned assets (?v=...), prefer network to pick up new content instantly
  const hasVersion = url.searchParams.has('v');

  e.respondWith(
    (async () => {
      try {
        const net = await fetch(e.request, { cache: hasVersion ? 'reload' : 'no-store' });
        // Optionally update cache for GET requests
        if (e.request.method === 'GET') {
          const cache = await caches.open(CACHE_NAME);
          cache.put(e.request, net.clone());
        }
        return net;
      } catch {
        // offline fallback
        const cached = await caches.match(e.request);
        if (cached) return cached;
        // final fallback: try root
        return caches.match('./');
      }
    })()
  );
});

const CACHE_NAME = 'rubik-pwa-v7-2025-10-21-v10';
const ASSETS = [
  './',
  './index.html?v=10',
  './style.css?v=10',
  './app.js?v=10',
  './cube.js?v=10',
  './manifest.webmanifest?v=10',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/three@0.160.0/build/three.min.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (url.searchParams.get('dev') === '1') {
    e.respondWith(fetch(e.request, { cache: 'reload' }).catch(() => caches.match(e.request)));
    return;
  }

  const hasVersion = url.searchParams.has('v');

  e.respondWith(
    (async () => {
      try {
        const net = await fetch(e.request, { cache: hasVersion ? 'reload' : 'no-store' });
        if (e.request.method === 'GET') {
          const cache = await caches.open(CACHE_NAME);
          cache.put(e.request, net.clone());
        }
        return net;
      } catch {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        return caches.match('./');
      }
    })()
  );
});

const CACHE_NAME = 'iris-caregiver-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-first fetch handler required for PWA installation criteria
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

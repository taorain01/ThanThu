'use strict';

// Service worker cho PWA Lang Gia - Bang Chiến.
// Chiến lược: network-first (luôn ưu tiên mạng, chỉ dùng cache khi offline)
// để không bao giờ phục vụ nội dung cũ khi còn mạng.

const CACHE_NAME = 'langgia-pwa-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API động: luôn đi thẳng mạng, không cache.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});

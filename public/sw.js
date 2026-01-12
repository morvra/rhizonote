const CACHE_NAME = 'rhizonote-v3.5.1';

// Install event: Pre-cache critical assets (App Shell)
// Note: Since filenames are hashed in Vite, we only explicitly cache the entry points.
// Dynamic assets will be cached at runtime.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        './',
        './index.html',
        './manifest.json',
        './icon.svg'
      ]);
    })
  );
  self.skipWaiting();
});

// Activate event: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event: Network First, falling back to Cache
// This strategy ensures the user gets the latest version when online,
// but can still access the app when offline.
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests (like Google Fonts, CDN scripts) if you want strict control,
  // but for this app, we'll cache them too to ensure full offline functionality.
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If network fetch is successful, cache the response
        // check if response is valid
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            // response.type 'basic' means it's a request from our origin. 
            // We might want to cache 'cors' responses too (like CDN scripts).
            if (networkResponse.type !== 'cors' && networkResponse.type !== 'default') {
                return networkResponse;
            }
        }

        const responseToCache = networkResponse.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      })
      .catch(() => {
        // If network fails (offline), return from cache
        return caches.match(event.request);
      })
  );
});
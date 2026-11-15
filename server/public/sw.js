const CACHE_NAME = 'yape-monitor-shell-v4';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/')
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return networkRes;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/index.html'))
      )
  );
});

// =========================================================================
// NOTIFICACIONES WEB PUSH CON APP PWA CERRADA O PANTALLA BLOQUEADA
// =========================================================================
self.addEventListener('push', (event) => {
  let data = {
    title: '💸 Nuevo Pago Recibido',
    body: 'Abre la app para verificar el código de seguridad.',
    tag: `yape-push-${Date.now()}`,
    url: '/'
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch {
      data.body = event.data.text() || data.body;
    }
  }

  const richOptions = {
    body: data.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: data.tag || `yape-push-${Date.now()}`,
    renotify: true,
    silent: false,
    requireInteraction: true,
    vibrate: [300, 120, 300, 120, 500],
    data: {
      url: data.url || '/',
      pagoId: data.id || null
    }
  };

  const notifyClientsPromise = self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((windowClients) => {
      windowClients.forEach((client) => {
        client.postMessage({ type: 'PUSH_PAYMENT_ALERT', payload: data });
      });
    })
    .catch(() => {});

  const showPromise = self.registration
    .showNotification(data.title, richOptions)
    .catch(() =>
      // Fallback universal para Safari iOS o navegadores con opciones restringidas
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/pwa-192x192.png',
        data: { url: data.url || '/' }
      })
    );

  event.waitUntil(Promise.all([showPromise, notifyClientsPromise]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

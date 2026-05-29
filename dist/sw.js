// TripMemo Service Worker — handles push notifications

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

// ── Push event: fired by server even when app is closed ───────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title ?? 'TripMemo ✈️';
  const options = {
    body:    data.body   ?? '',
    icon:    data.icon   ?? '/icon-192.svg',
    badge:   data.badge  ?? '/icon-192.svg',
    tag:     data.tag    ?? 'tripmemo',
    data:    { url: data.url ?? '/' },
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open/focus the app ────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // If app already open — focus it
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      // Otherwise open a new window
      return clients.openWindow(event.notification.data?.url ?? '/');
    })
  );
});

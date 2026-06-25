// TripMemo Service Worker — handles push notifications

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

// ── Push event: fired by server even when app is closed ───────────────────────
self.addEventListener('push', (event) => {
  // Use scope-relative icon so the path is correct regardless of base URL
  // e.g. "https://user.github.io/trip-planner/" + "icon-192.png"
  const scope = self.registration.scope;
  const iconUrl = scope + 'icon-192.png';

  const data = event.data?.json() ?? {};
  const title = data.title ?? 'TripMemo ✈️';
  const options = {
    body:    data.body   ?? '',
    icon:    data.icon   ?? iconUrl,
    badge:   data.badge  ?? iconUrl,
    tag:     data.tag    ?? 'tripmemo',
    data:    { url: data.url ?? scope },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
      .catch((err) => console.error('[SW] showNotification failed:', err))
  );
});

// ── Notification click: open/focus the app ────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // If app already open — focus it
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      // Otherwise open the app
      return clients.openWindow(targetUrl);
    })
  );
});

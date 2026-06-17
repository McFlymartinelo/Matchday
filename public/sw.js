const CACHE = 'matchday-v6';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;

  // Navigation uniquement : fallback SPA. Ne jamais servir index.html pour .js/.css
  // (sinon page blanche si le réseau échoue pendant un cold start Render).
  const isNavigate = e.request.mode === 'navigate'
    || (e.request.method === 'GET' && e.request.headers.get('accept')?.includes('text/html'));

  if (isNavigate) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  e.respondWith(fetch(e.request));
});

function parsePushPayload(event) {
  const fallback = { title: 'Matchday', body: 'Nouvelle notification', url: '/?screen=matches' };
  if (!event.data) return fallback;
  try {
    return { ...fallback, ...JSON.parse(event.data.text()) };
  } catch {
    return { ...fallback, body: event.data.text() || fallback.body };
  }
}

async function notifyClients(payload) {
  const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of allClients) {
    client.postMessage({ type: 'MATCHDAY_PUSH', payload });
  }
}

async function showMatchdayNotification(data) {
  await self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag ?? `matchday-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    data: { url: data.url ?? '/?screen=matches' },
  });
}

self.addEventListener('push', (e) => {
  const data = parsePushPayload(e);
  e.waitUntil(
    (async () => {
      await notifyClients(data);
      try {
        await showMatchdayNotification(data);
      } catch {
        await self.registration.showNotification('Matchday', { body: data.body });
      }
    })()
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url ?? '/?screen=matches';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          if (typeof client.navigate === 'function') {
            return client.navigate(target).then(() => client.focus());
          }
          client.focus();
          return;
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

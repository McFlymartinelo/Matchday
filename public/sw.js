const CACHE = 'matchday-v10';

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

function scopeOrigin() {
  return new URL(self.registration.scope).origin;
}

function sameAppClient(client) {
  try {
    return new URL(client.url).origin === scopeOrigin();
  } catch {
    return false;
  }
}

async function notifyClients(payload) {
  const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of allClients) {
    if (sameAppClient(client)) {
      client.postMessage({ type: 'MATCHDAY_PUSH', payload });
    }
  }
}

async function showMatchdayNotification(data) {
  const path = data.url ?? '/?screen=matches';
  await self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag ?? `matchday-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    data: {
      url: path,
      matchId: data.matchId ?? null,
      groupId: data.groupId ?? null,
      competitionId: data.competitionId ?? null,
    },
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
        await self.registration.showNotification('Matchday', {
          body: data.body,
          data: { url: data.url ?? '/?screen=matches' },
        });
      }
    })()
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data ?? {};
  const path = data.url ?? '/?screen=matches';
  const payload = { ...data, url: path };

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const appClients = list.filter(sameAppClient);

      if (appClients.length > 0) {
        const client = appClients[0];
        await client.focus();
        client.postMessage({ type: 'MATCHDAY_NAV', payload });
        return;
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(path);
      }
    })
  );
});

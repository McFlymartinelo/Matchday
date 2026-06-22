import { api, showToast } from './api.js';

const SW_URL = '/sw.js?v=10';
const PENDING_NAV_KEY = 'matchday_pending_nav';

let navHandler = null;
let pushHandler = null;

export function parseNavFromPayload(payload) {
  if (!payload) return null;
  if (payload.matchId) {
    return {
      matchId: Number(payload.matchId),
      groupId: payload.groupId ? Number(payload.groupId) : null,
      competitionId: payload.competitionId ? Number(payload.competitionId) : null,
    };
  }
  if (payload.url) {
    try {
      const params = new URL(payload.url, window.location.origin).searchParams;
      return {
        matchId: params.get('match') ? Number(params.get('match')) : null,
        groupId: params.get('group') ? Number(params.get('group')) : null,
        competitionId: params.get('comp') ? Number(params.get('comp')) : null,
      };
    } catch { /* ignore */ }
  }
  return null;
}

export function stashNotificationDeepLinkFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const matchId = params.get('match');
  const screen = params.get('screen');
  if (!matchId && screen !== 'matches') return;

  sessionStorage.setItem(PENDING_NAV_KEY, JSON.stringify({
    matchId: matchId ? Number(matchId) : null,
    groupId: params.get('group') ? Number(params.get('group')) : null,
    competitionId: params.get('comp') ? Number(params.get('comp')) : null,
  }));
  history.replaceState({}, '', window.location.pathname);
}

export function stashPendingNav(payload) {
  const nav = parseNavFromPayload(payload);
  if (!nav?.matchId) return;
  sessionStorage.setItem(PENDING_NAV_KEY, JSON.stringify(nav));
}

export function consumePendingNav() {
  const raw = sessionStorage.getItem(PENDING_NAV_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_NAV_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function navigateToMatchDeepLink(payload) {
  stashPendingNav(payload);
  const nav = parseNavFromPayload(payload);
  const path = payload?.url || (nav?.matchId
    ? `/?screen=matches&group=${nav.groupId || ''}&match=${nav.matchId}${nav.competitionId ? `&comp=${nav.competitionId}` : ''}`
    : '/?screen=matches');
  window.location.assign(path.startsWith('/') ? path : `/${path}`);
}

export function registerPushHandlers({ onNav, onPush }) {
  navHandler = onNav;
  pushHandler = onPush;
}

function handleServiceWorkerMessage(event) {
  const { type, payload } = event.data ?? {};
  if (type === 'MATCHDAY_NAV') {
    if (parseNavFromPayload(payload)?.matchId) {
      navigateToMatchDeepLink(payload);
      return;
    }
    stashPendingNav(payload);
    if (navHandler) {
      navHandler(payload);
      return;
    }
    const path = payload?.url || '/?screen=matches';
    window.location.assign(path.startsWith('/') ? path : `/${path}`);
    return;
  }
  if (type === 'MATCHDAY_PUSH') {
    pushHandler?.(payload);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
  navigator.serviceWorker.register(SW_URL).catch(() => {});
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function notificationsEnabled() {
  return localStorage.getItem('matchday_notifications') === 'on';
}

async function getServiceWorkerRegistration() {
  const reg = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;
  return reg;
}

/** Notification système — essaie plusieurs méthodes (Opera/Windows). */
export function showSystemNotification(title, body, clickUrl) {
  if (Notification.permission !== 'granted') return false;

  let shown = false;
  const openUrl = clickUrl || '/?screen=matches';

  try {
    const n = new Notification(title, {
      body,
      tag: `md-${Date.now()}`,
      requireInteraction: true,
    });
    n.onclick = () => {
      n.close();
      window.focus();
      window.location.assign(openUrl);
    };
    shown = true;
  } catch {
    /* fallback SW ci-dessous */
  }

  if (!shown) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, {
        body,
        tag: `md-sw-${Date.now()}`,
        requireInteraction: true,
        data: { url: openUrl },
      }))
      .catch(() => {});
  }

  return true;
}

export async function getNotificationStatus() {
  const status = {
    supported: 'Notification' in window,
    pushSupported: 'PushManager' in window && 'serviceWorker' in navigator,
    permission: Notification.permission,
    enabled: notificationsEnabled(),
    subscription: false,
    vapidConfigured: false,
  };

  if (status.pushSupported && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_URL);
      status.subscription = !!(await reg?.pushManager?.getSubscription());
    } catch { /* ignore */ }
  }

  try {
    const vapid = await api('/notifications/vapid-public-key');
    status.vapidConfigured = !!vapid.configured;
  } catch { /* ignore */ }

  return status;
}

export async function showLocalTestNotification() {
  if (Notification.permission !== 'granted') {
    throw new Error('Permission non accordée');
  }
  showSystemNotification(
    '🔔 Matchday — test',
    'Si tu vois ceci, les notifications système fonctionnent !'
  );
}

export async function enablePushNotifications() {
  if (!('Notification' in window)) {
    showToast('Notifications non supportées');
    return false;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('Push indisponible sur ce navigateur');
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    showToast('Permission refusée — autorise Matchday dans Opera et Windows');
    localStorage.setItem('matchday_notifications', 'off');
    return false;
  }

  let vapid;
  try {
    vapid = await api('/notifications/vapid-public-key');
  } catch {
    showToast('Serveur push non configuré (VAPID dans .env)');
    return false;
  }
  if (!vapid.configured || !vapid.publicKey) {
    showToast('Clés VAPID manquantes — npm run vapid:keys');
    return false;
  }

  await showLocalTestNotification();

  const reg = await getServiceWorkerRegistration();
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
  });

  const result = await api('/notifications/subscribe', {
    method: 'POST',
    body: JSON.stringify(sub.toJSON()),
  });

  localStorage.setItem('matchday_notifications', 'on');

  if (result.test?.sent > 0) {
    showToast('Push activé — vérifie aussi la bannière violette en haut');
  } else {
    showToast('Rappels activés — bannière + toast même si push OS bloqué');
  }

  return true;
}

export async function disablePushNotifications() {
  localStorage.setItem('matchday_notifications', 'off');
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/notifications/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
  showToast('Notifications désactivées');
}

export async function syncPushIfEnabled() {
  if (!notificationsEnabled()) return;
  if (Notification.permission !== 'granted') {
    localStorage.setItem('matchday_notifications', 'off');
    return;
  }
}

export async function sendTestPushFromApp() {
  await showLocalTestNotification();
  try {
    const result = await api('/notifications/test', { method: 'POST' });
    if (result.result?.sent > 0) {
      showToast('Push serveur envoyé + test local ✓');
    } else {
      showToast('Test local OK — push serveur non délivré (normal sur Opera parfois)');
    }
  } catch (err) {
    showToast(`Test local OK — ${err.message}`);
  }
}

export function setupPushMessageListener(onPush, onNav) {
  registerPushHandlers({ onPush, onNav });
}

export function openNotificationPanel(anchorEl, { onEnabled, onDisabled }) {
  document.getElementById('notif-panel')?.remove();

  getNotificationStatus().then(status => {
    const panel = document.createElement('div');
    panel.id = 'notif-panel';
    panel.className = 'notif-panel';
    panel.innerHTML = `
      <div class="notif-panel-head"><strong>Rappels Matchday</strong></div>
      <div class="notif-panel-row">Permission : <span>${status.permission}</span></div>
      <div class="notif-panel-row">Push abonné : <span>${status.subscription ? 'oui' : 'non'}</span></div>
      <div class="notif-panel-row">Serveur VAPID : <span class="${status.vapidConfigured ? 'notif-ok' : 'notif-warn'}">${status.vapidConfigured ? 'ok' : 'manquant'}</span></div>
      ${!status.vapidConfigured ? `<p class="notif-panel-hint notif-panel-warn">Ajoute <code>VAPID_PUBLIC_KEY</code> et <code>VAPID_PRIVATE_KEY</code> dans les variables Render (ou ton <code>.env</code> local). Génère-les avec <code>npm run vapid:keys</code>.</p>` : ''}
      <p class="notif-panel-hint">Sur iPhone : installe l'app sur l'écran d'accueil (PWA) pour recevoir les push. Sinon la bannière violette reste active 1h avant chaque match.</p>
      <div class="notif-panel-actions">
        ${status.enabled
          ? `<button type="button" class="btn btn-secondary" id="notif-test">Tester</button>
             <button type="button" class="btn btn-secondary" id="notif-off">Désactiver</button>`
          : `<button type="button" class="btn btn-primary" id="notif-on">Activer</button>`}
      </div>
    `;

    const rect = anchorEl.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 8}px`;
    panel.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    document.body.appendChild(panel);

    panel.querySelector('#notif-on')?.addEventListener('click', async () => {
      const ok = await enablePushNotifications();
      if (ok) onEnabled?.();
      panel.remove();
    });
    panel.querySelector('#notif-test')?.addEventListener('click', async () => {
      await sendTestPushFromApp();
      const { demoReminder } = await import('./reminders.js');
      demoReminder(onEnabled);
    });
    panel.querySelector('#notif-off')?.addEventListener('click', async () => {
      await disablePushNotifications();
      onDisabled?.();
      panel.remove();
    });

    setTimeout(() => {
      document.addEventListener('click', function closePanel(ev) {
        if (!panel.contains(ev.target) && ev.target !== anchorEl) {
          panel.remove();
          document.removeEventListener('click', closePanel);
        }
      });
    }, 0);
  });
}

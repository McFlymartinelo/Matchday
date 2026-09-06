import { api, showToast } from './api.js';

const SW_URL = '/sw.js?v=18';
const PENDING_NAV_KEY = 'matchday_pending_nav';
const SW_REGISTER_OPTS = { scope: '/', updateViaCache: 'none' };

let cachedVapid = null;

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
  if (type === 'MATCHDAY_PUSH_RESUBSCRIBE') {
    syncPushIfEnabled().catch(() => {});
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
  navigator.serviceWorker.register(SW_URL, SW_REGISTER_OPTS).catch(() => {});
  getVapidPublicKeyCached().catch(() => {});
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

export function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandaloneDisplay() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

/** iOS n’expose Push/Notification que dans la PWA écran d’accueil. */
export function detectPushContext() {
  const standalone = isStandaloneDisplay();
  const hasPush = 'serviceWorker' in navigator && 'PushManager' in window;
  const hasNotification = 'Notification' in window;
  const ios = isIosDevice();
  return {
    ios,
    standalone,
    canSubscribe: hasPush && hasNotification,
    needsInstall: ios && !standalone,
  };
}

async function getVapidPublicKeyCached() {
  if (cachedVapid?.publicKey) return cachedVapid;
  cachedVapid = await api('/notifications/vapid-public-key');
  return cachedVapid;
}

async function getServiceWorkerRegistration() {
  const reg = await navigator.serviceWorker.register(SW_URL, SW_REGISTER_OPTS);
  await navigator.serviceWorker.ready;
  return reg;
}

/** Notification système — iOS n’a pas `new Notification()`, uniquement le SW. */
export function showSystemNotification(title, body, clickUrl) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;

  const openUrl = clickUrl || '/?screen=matches';
  const options = { body, tag: `md-${Date.now()}`, data: { url: openUrl } };

  if (!isIosDevice()) {
    try {
      const n = new Notification(title, options);
      n.onclick = () => {
        n.close();
        window.focus();
        window.location.assign(openUrl);
      };
      return true;
    } catch {
      /* fallback SW */
    }
  }

  navigator.serviceWorker.ready
    .then(reg => reg.showNotification(title, options))
    .catch(() => {});
  return true;
}

export async function getNotificationStatus() {
  const ctx = detectPushContext();
  const status = {
    supported: ctx.canSubscribe,
    pushSupported: ctx.canSubscribe,
    permission: ctx.canSubscribe ? Notification.permission : 'default',
    enabled: notificationsEnabled(),
    subscription: false,
    vapidConfigured: false,
    ...ctx,
  };

  if (ctx.canSubscribe && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      status.subscription = !!(await reg?.pushManager?.getSubscription());
    } catch { /* ignore */ }
  }

  try {
    const vapid = await getVapidPublicKeyCached();
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
  const ctx = detectPushContext();
  if (ctx.needsInstall) {
    showToast('Sur iPhone : Partager → Sur l’écran d’accueil, puis ouvre l’icône Matchday');
    return false;
  }
  if (!ctx.canSubscribe) {
    showToast('Push indisponible sur ce navigateur');
    return false;
  }

  // Précharge VAPID + SW pendant la boîte de permission (geste iOS conservé).
  const vapidPromise = getVapidPublicKeyCached();
  const swPromise = getServiceWorkerRegistration();

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    showToast(ctx.ios
      ? 'Permission refusée — Réglages iPhone → Notifications → Matchday'
      : 'Permission refusée — autorise Matchday dans le navigateur');
    localStorage.setItem('matchday_notifications', 'off');
    return false;
  }

  let vapid;
  try {
    vapid = await vapidPromise;
  } catch {
    showToast('Serveur push non configuré (VAPID dans .env)');
    return false;
  }
  if (!vapid.configured || !vapid.publicKey) {
    showToast('Clés VAPID manquantes — npm run vapid:keys');
    return false;
  }

  try {
    const reg = await swPromise;
    let sub = await reg.pushManager.getSubscription();
    if (!sub || !applicationServerKeyMatches(sub, vapid.publicKey)) {
      if (sub) await sub.unsubscribe();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
      });
    }

    const result = await api('/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify(sub.toJSON()),
    });

    localStorage.setItem('matchday_notifications', 'on');
    await showLocalTestNotification();

    if (result.test?.sent > 0) {
      showToast('Push activé — une notif test doit apparaître');
    } else {
      showToast(ctx.ios
        ? 'Abonné — si rien n’arrive, ferme l’app et réessaie depuis l’icône'
        : 'Rappels activés — bannière + toast même si push OS bloqué');
    }
    return true;
  } catch (err) {
    showToast(err.message || 'Abonnement push refusé');
    return false;
  }
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

function applicationServerKeyMatches(subscription, publicKey) {
  const expected = urlBase64ToUint8Array(publicKey);
  const actual = subscription.options?.applicationServerKey;
  if (!actual) return true;
  const bytes = new Uint8Array(actual);
  if (bytes.length !== expected.length) return false;
  return bytes.every((b, i) => b === expected[i]);
}

export async function syncPushIfEnabled() {
  if (!notificationsEnabled()) return;
  const ctx = detectPushContext();
  if (ctx.needsInstall) return;
  if (!ctx.canSubscribe || Notification.permission !== 'granted') {
    localStorage.setItem('matchday_notifications', 'off');
    return;
  }

  try {
    const vapid = await getVapidPublicKeyCached();
    if (!vapid.configured || !vapid.publicKey) return;

    const reg = await getServiceWorkerRegistration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub || !applicationServerKeyMatches(sub, vapid.publicKey)) {
      if (sub) await sub.unsubscribe();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
      });
    }

    await api('/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify({ ...sub.toJSON(), quiet: true }),
    });
  } catch (err) {
    console.warn('Sync push:', err.message);
  }
}

export async function sendTestPushFromApp() {
  await syncPushIfEnabled();
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
    const installHint = status.needsInstall
      ? `<p class="notif-panel-hint notif-panel-warn">Sur iPhone, Safari ne peut pas recevoir les push. Installe l’app :</p>
         <ol class="notif-panel-steps">
           <li>Bouton <strong>Partager</strong> (carré + flèche)</li>
           <li><strong>Sur l’écran d’accueil</strong></li>
           <li>Ouvre Matchday depuis l’icône, puis reviens ici</li>
         </ol>`
      : `<p class="notif-panel-hint">Rappels : chaque matin (matchs du jour) et ~1h avant le coup d'envoi si tu n'as pas pronostiqué.</p>`;

    panel.innerHTML = `
      <div class="notif-panel-head"><strong>Rappels Matchday</strong></div>
      <div class="notif-panel-row">Permission : <span>${status.permission}</span></div>
      <div class="notif-panel-row">Push abonné : <span>${status.subscription ? 'oui' : 'non'}</span></div>
      <div class="notif-panel-row">Serveur VAPID : <span class="${status.vapidConfigured ? 'notif-ok' : 'notif-warn'}">${status.vapidConfigured ? 'ok' : 'manquant'}</span></div>
      ${!status.vapidConfigured ? `<p class="notif-panel-hint notif-panel-warn">Ajoute <code>VAPID_PUBLIC_KEY</code> et <code>VAPID_PRIVATE_KEY</code> dans les variables Render (ou ton <code>.env</code> local). Génère-les avec <code>npm run vapid:keys</code>.</p>` : ''}
      ${installHint}
      <div class="notif-panel-actions">
        ${status.needsInstall
          ? ''
          : status.enabled
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
      try {
        const ok = await enablePushNotifications();
        if (ok) onEnabled?.();
      } catch (err) {
        showToast(err.message || 'Impossible d’activer les notifications');
      }
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

import { api, showToast } from './api.js';

const SW_URL = '/sw.js?v=5';

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
export function showSystemNotification(title, body) {
  if (Notification.permission !== 'granted') return false;

  let shown = false;

  try {
    const n = new Notification(title, {
      body,
      tag: `md-${Date.now()}`,
      requireInteraction: true,
    });
    n.onclick = () => { window.focus(); n.close(); };
    shown = true;
  } catch {
    /* fallback SW ci-dessous */
  }

  if (!shown) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, { body, tag: `md-sw-${Date.now()}`, requireInteraction: true }))
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

export function setupPushMessageListener(onPush) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'MATCHDAY_PUSH') {
      onPush(e.data.payload);
    }
  });
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
      <div class="notif-panel-row">Serveur VAPID : <span>${status.vapidConfigured ? 'ok' : 'manquant'}</span></div>
      <p class="notif-panel-hint">Même si Windows/Opera bloque le push, tu verras une <strong>bannière violette</strong> et un toast 1h avant chaque match non pronostiqué.</p>
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

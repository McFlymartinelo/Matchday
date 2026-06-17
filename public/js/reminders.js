import { matches, showToast } from './api.js';
import { showSystemNotification, notificationsEnabled } from './notifications.js';

const REMINDER_MIN = Number(localStorage.getItem('matchday_reminder_min') || 55);
const REMINDER_MAX = Number(localStorage.getItem('matchday_reminder_max') || 65);

let pollTimer = null;

export function showReminderBanner(match, onGo) {
  document.querySelectorAll('.reminder-banner').forEach(el => el.remove());

  const mins = Math.max(1, Math.round((new Date(match.kickoff_at) - Date.now()) / 60000));
  const banner = document.createElement('div');
  banner.className = 'reminder-banner';
  banner.innerHTML = `
    <div class="reminder-banner-inner">
      <div class="reminder-banner-text">
        <strong>⏰ Pronostic à faire</strong>
        <span>${match.home_team_name} vs ${match.away_team_name} · dans ~${mins} min</span>
      </div>
      <button type="button" class="btn btn-primary reminder-go">Pronostiquer</button>
      <button type="button" class="reminder-close" aria-label="Fermer">✕</button>
    </div>
  `;

  banner.querySelector('.reminder-go').onclick = () => {
    banner.remove();
    onGo?.();
  };
  banner.querySelector('.reminder-close').onclick = () => banner.remove();

  document.body.appendChild(banner);
}

export function alertForMatch(match, onGo) {
  const mins = Math.max(1, Math.round((new Date(match.kickoff_at) - Date.now()) / 60000));
  const body = `${match.home_team_name} vs ${match.away_team_name} dans ~${mins} min`;

  showReminderBanner(match, onGo);
  showToast(`⏰ ${body}`);
  showSystemNotification('⏰ Pronostic à faire', body);
}

export async function checkMatchReminders(state, onGo) {
  if (!state.group?.id || !notificationsEnabled()) return [];

  const list = await matches.list(state.group.id);
  const now = Date.now();
  const alerted = [];

  for (const m of list) {
    if (m.prediction || m.isLocked) continue;
    const mins = (new Date(m.kickoff_at) - now) / 60000;
    if (mins < REMINDER_MIN || mins > REMINDER_MAX) continue;

    const key = `md-reminder-${m.id}`;
    if (sessionStorage.getItem(key)) continue;

    sessionStorage.setItem(key, '1');
    alertForMatch(m, onGo);
    alerted.push(m);
  }

  return alerted;
}

export function startMatchReminders(state, onGo) {
  stopMatchReminders();
  if (!notificationsEnabled()) return;

  const tick = () => checkMatchReminders(state, onGo).catch(() => {});
  tick();
  pollTimer = setInterval(tick, 60000);
}

export function stopMatchReminders() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Pour les tests : simule un rappel visuel immédiat */
export function demoReminder(onGo) {
  alertForMatch({
    home_team_name: 'Paris Saint-Germain',
    away_team_name: 'Olympique de Marseille',
    kickoff_at: new Date(Date.now() + 3600000).toISOString(),
  }, onGo);
}

export function handlePushPayload(payload, state, onGo) {
  showToast(`🔔 ${payload.body ?? payload.title ?? 'Notification'}`);
  if (payload.url?.includes('matches') || payload.url === '/?screen=matches') {
    showReminderBanner({
      home_team_name: payload.body?.split(' vs ')?.[0] ?? 'Match',
      away_team_name: payload.body?.split(' vs ')?.[1]?.split(' dans')?.[0] ?? '',
      kickoff_at: new Date(Date.now() + 3600000).toISOString(),
    }, onGo);
  }
}

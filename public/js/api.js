const API = '/api';

function getToken() {
  return localStorage.getItem('matchday_token');
}

function setToken(token) {
  if (token) localStorage.setItem('matchday_token', token);
  else localStorage.removeItem('matchday_token');
}

/** Normalise un id championnat (évite les resets string vs number). */
export function compId(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function sameCompId(a, b) {
  const na = compId(a);
  const nb = compId(b);
  return na != null && nb != null && na === nb;
}

export function findCompetition(comps, id) {
  const wanted = compId(id);
  if (wanted == null) return null;
  return comps.find(c => sameCompId(c.id, wanted)) ?? null;
}

export function loadSavedCompId(key, comps) {
  const saved = compId(localStorage.getItem(key));
  if (saved == null) return null;
  return findCompetition(comps, saved) ? saved : null;
}

export function saveCompId(key, id) {
  const n = compId(id);
  if (n != null) localStorage.setItem(key, String(n));
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function apiPublic(path) {
  const res = await fetch(`${API}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export const auth = {
  register: (body) => api('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => api('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  sendOtp: (body) => api('/auth/send-otp', { method: 'POST', body: JSON.stringify(body) }),
  verifyOtp: (body) => api('/auth/verify-otp', { method: 'POST', body: JSON.stringify(body) }),
  resendOtp: (body) => api('/auth/resend-otp', { method: 'POST', body: JSON.stringify(body) }),
  changePassword: (body) => api('/auth/change-password', { method: 'POST', body: JSON.stringify(body) }),
  me: () => api('/auth/me'),
  updateProfile: (body) => api('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  logout: () => setToken(null),
  setToken,
  getToken,
  isLoggedIn: () => !!getToken(),
};

export const groups = {
  list: () => api('/groups/mine'),
  public: () => api('/groups/public'),
  publicList: () => apiPublic('/groups/public/list'),
  create: (body) => api('/groups', { method: 'POST', body: JSON.stringify(body) }),
  join: (payload) => {
    const body = typeof payload === 'string' ? { inviteCode: payload } : payload;
    return api('/groups/join', { method: 'POST', body: JSON.stringify(body) });
  },
  get: (id) => api(`/groups/${id}`),
  competitions: () => api('/groups/competitions'),
  updateCompetitions: (id, competitionIds) =>
    api(`/groups/${id}/competitions`, { method: 'PATCH', body: JSON.stringify({ competitionIds }) }),
  clubs: (groupId) => api(`/groups/${groupId}/clubs`),
};

export const specialBets = {
  list: (groupId) => api(`/groups/${groupId}/special-bets`),
  teams: (groupId, competitionId) => api(`/groups/${groupId}/special-bets/teams/${competitionId}`),
  save: (groupId, body) => api(`/groups/${groupId}/special-bets`, { method: 'POST', body: JSON.stringify(body) }),
};

export const matches = {
  list: (groupId, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api(`/groups/${groupId}/matches${q ? '?' + q : ''}`);
  },
  detail: (groupId, matchId) => api(`/groups/${groupId}/matches/${matchId}`),
  predict: (groupId, body) =>
    api(`/groups/${groupId}/predictions`, { method: 'POST', body: JSON.stringify(body) }),
  groupPredictions: (groupId, matchId) =>
    api(`/groups/${groupId}/matches/${matchId}/predictions`),
};

export const standings = {
  general: (groupId, competitionId) => {
    const q = competitionId ? `?competitionId=${competitionId}` : '';
    return api(`/groups/${groupId}/standings${q}`);
  },
  matchday: (groupId, matchday, competitionId) => {
    const q = competitionId ? `?competitionId=${competitionId}` : '';
    return api(`/groups/${groupId}/standings/matchday/${matchday}${q}`);
  },
  official: (groupId, competitionId) =>
    api(`/groups/${groupId}/standings/official/${competitionId}`),
  allOfficial: (groupId) => api(`/groups/${groupId}/standings/official`),
  stats: (groupId, userId) => {
    const q = userId ? `?userId=${userId}` : '';
    return api(`/groups/${groupId}/stats${q}`);
  },
  profile: (groupId) => api(`/groups/${groupId}/profile`),
  analytics: (groupId) => api(`/groups/${groupId}/analytics`),
  history: (groupId, competitionId) => {
    const q = competitionId ? `?competitionId=${competitionId}` : '';
    return api(`/groups/${groupId}/standings/history${q}`);
  },
  duel: (groupId, userIdA, userIdB) => api(`/groups/${groupId}/duel?a=${userIdA}&b=${userIdB}`),
};

export const seasonXi = {
  get: (groupId, userId) => {
    const q = userId ? `?userId=${userId}` : '';
    return api(`/groups/${groupId}/season-xi${q}`);
  },
  save: (groupId, players, formation = '433') =>
    api(`/groups/${groupId}/season-xi`, {
      method: 'PUT',
      body: JSON.stringify({ players, formation }),
    }),
  search: (groupId, q, competitionId) => {
    const params = new URLSearchParams({ q });
    if (competitionId) params.set('competitionId', competitionId);
    return api(`/groups/${groupId}/season-xi/search?${params}`);
  },
  browse: (groupId, competitionId, q) => {
    const params = new URLSearchParams();
    if (competitionId) params.set('competitionId', competitionId);
    if (q) params.set('q', q);
    const qs = params.toString();
    return api(`/groups/${groupId}/season-xi/browse${qs ? `?${qs}` : ''}`);
  },
};

export const chat = {
  list: (groupId) => api(`/groups/${groupId}/chat`),
  send: (groupId, content) =>
    api(`/groups/${groupId}/chat`, { method: 'POST', body: JSON.stringify({ content }) }),
  react: (groupId, messageId, emoji) =>
    api(`/groups/${groupId}/chat/${messageId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }),
};

export function showToast(msg, type = 'default') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast toast-${type}`;
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

export function compColors(code) {
  const map = {
    L1: { color: 'var(--l1)', bg: 'var(--l1-bg)', cls: 'l1' },
    PL: { color: 'var(--pl)', bg: 'var(--pl-bg)', cls: 'pl' },
    PD: { color: 'var(--liga)', bg: 'var(--liga-bg)', cls: 'liga' },
    SA: { color: 'var(--serie)', bg: 'var(--serie-bg)', cls: 'serie' },
    BL1: { color: 'var(--bundesliga)', bg: 'var(--bundesliga-bg)', cls: 'bl1' },
  };
  return map[code] ?? { color: 'var(--pl)', bg: 'var(--pl-bg)', cls: 'pl' };
}

export function compLogoHtml(comp, className = 'comp-logo') {
  const logo = comp?.logo?.replace(/\.svg(\?.*)?$/i, '.png$1');
  if (logo) {
    const fallback = (comp.emoji ?? comp.code ?? '').replace(/'/g, "\\'");
    return `<img src="${logo}" alt="" class="${className}" loading="lazy"
      onerror="this.outerHTML='${fallback}'">`;
  }
  return comp?.emoji ?? '';
}

export function normTeamName(name) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function buildTeamLogoMap(groupId) {
  const map = new Map();
  try {
    const clubs = await groups.clubs(groupId);
    for (const t of clubs) {
      map.set(normTeamName(t.team_name), t.team_id);
      if (t.short_name) map.set(normTeamName(t.short_name), t.team_id);
    }
  } catch { /* ignore */ }
  return map;
}

export function teamCrest(name, compCode, teamId = null) {
  const c = compColors(compCode);
  const letters = (name || '???').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || '???';
  const logoUrl = teamId ? `https://sports.bzzoiro.com/img/team/${teamId}/?bg=transparent` : null;

  if (logoUrl) {
    return `<span class="crest-wrap">
      <img src="${logoUrl}" alt="" class="crest-img" loading="lazy"
        onerror="this.classList.add('hidden');this.nextElementSibling?.classList.remove('hidden')">
      <span class="crest-sm crest-fallback hidden" style="background:${c.bg};color:${c.color}">${letters}</span>
    </span>`;
  }

  return `<div class="crest-sm" style="background:${c.bg};color:${c.color}">${letters}</div>`;
}

const PARIS_TZ = 'Europe/Paris';

export function parseKickoffDate(kickoff) {
  if (!kickoff) return null;
  const raw = String(kickoff);
  const d = raw.includes('T') || /Z|[+-]\d{2}:?\d{2}$/.test(raw)
    ? new Date(raw)
    : new Date(`${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatKickoffLabel(kickoff) {
  const d = parseKickoffDate(kickoff);
  if (!d) return '';

  const parts = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: PARIS_TZ,
  }).formatToParts(d);

  const pick = (type) => parts.find(p => p.type === type)?.value ?? '';
  const weekdayRaw = pick('weekday').replace(/\.$/, '');
  const day = pick('day');
  const month = pick('month').replace(/\.$/, '');
  const hour = pick('hour').padStart(2, '0');
  const minute = pick('minute').padStart(2, '0');
  if (!day || !hour) return '';

  const weekday = weekdayRaw
    ? `${weekdayRaw.charAt(0).toUpperCase()}${weekdayRaw.slice(1).toLowerCase()}.`
    : '';
  return `${weekday} ${day} ${month} · ${hour}h${minute}`.replace(/^\s+/, '');
}

export function formatCountdown(kickoff) {
  const d = parseKickoffDate(kickoff);
  if (!d) return null;
  const diff = d - new Date();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `⏳ ${Math.floor(h / 24)}j ${h % 24}h`;
  if (h < 1) return `⏳ ${m}min`;
  return `⏳ ${h}h ${m}min`;
}

export function initials(name) {
  const raw = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return escapeHtml(raw);
}

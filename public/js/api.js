const API = '/api';

function getToken() {
  return localStorage.getItem('matchday_token');
}

function setToken(token) {
  if (token) localStorage.setItem('matchday_token', token);
  else localStorage.removeItem('matchday_token');
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

export async function apiPublic(path) {
  const res = await fetch(`${API}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export const auth = {
  register: (body) => api('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => api('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
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

export const matches = {
  list: (groupId, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api(`/groups/${groupId}/matches${q ? '?' + q : ''}`);
  },
  detail: (groupId, matchId) => api(`/groups/${groupId}/matches/${matchId}`),
  predict: (groupId, body) =>
    api(`/groups/${groupId}/predictions`, { method: 'POST', body: JSON.stringify(body) }),
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
};

export const seasonXi = {
  get: (groupId, userId) => {
    const q = userId ? `?userId=${userId}` : '';
    return api(`/groups/${groupId}/season-xi${q}`);
  },
  save: (groupId, players) =>
    api(`/groups/${groupId}/season-xi`, { method: 'PUT', body: JSON.stringify({ players }) }),
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

export function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
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

export function teamCrest(name, compCode) {
  const c = compColors(compCode);
  const letters = (name || '???').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || '???';
  return `<div class="crest-sm" style="background:${c.bg};color:${c.color}">${letters}</div>`;
}

export function formatCountdown(kickoff) {
  const diff = new Date(kickoff) - new Date();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `⏳ ${Math.floor(h / 24)}j ${h % 24}h`;
  if (h < 1) return `⏳ ${m}min`;
  return `⏳ ${h}h ${m}min`;
}

export function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

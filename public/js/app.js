import { auth, groups, matches, standings, chat, showToast, compColors, teamCrest, formatCountdown, initials } from './api.js';
import { renderAvatarHtml } from './avatars.js';
import { renderProfile } from './profile.js';
import { renderChampionships } from './championships.js';
import { renderSeasonXi } from './seasonXi.js';
import { syncPushIfEnabled, notificationsEnabled, openNotificationPanel, setupPushMessageListener } from './notifications.js';
import { startMatchReminders, stopMatchReminders, handlePushPayload } from './reminders.js';

const state = {
  user: null,
  group: null,
  myGroups: [],
  competitions: [],
  activeComp: null,
  screen: 'matches',
  standingsTab: 'general',
};

const app = document.getElementById('app');

export async function init() {
  if (!auth.isLoggedIn()) {
    renderAuth();
    return;
  }
  try {
    state.user = await auth.me();
    state.myGroups = await groups.list();
    if (state.myGroups.length === 0) {
      renderOnboarding();
      return;
    }
    const savedGroupId = localStorage.getItem('matchday_group');
    const groupId = savedGroupId && state.myGroups.find(g => g.id == savedGroupId)
      ? savedGroupId : state.myGroups[0].id;
    await loadGroup(groupId);
    await syncPushIfEnabled();
    setupPushMessageListener((payload) => {
      handlePushPayload(payload, state, goToMatches);
    });
    startMatchReminders(state, goToMatches);
    renderApp();
  } catch (err) {
    auth.logout();
    renderAuth();
    throw err;
  }
}

async function loadGroup(groupId) {
  stopMatchReminders();
  state.group = await groups.get(groupId);
  state.competitions = state.group.competitions ?? [];
  state.activeComp = state.competitions[0]?.id ?? null;
  localStorage.setItem('matchday_group', groupId);
  if (notificationsEnabled()) {
    startMatchReminders(state, goToMatches);
  }
}

function goToMatches() {
  state.screen = 'matches';
  renderApp();
}

function renderAuth() {
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-logo">⚽</div>
        <div class="auth-title">Matchday</div>
        <div class="auth-sub">Pronostics entre amis</div>
        <form id="auth-form" novalidate>
          <div class="form-group">
            <label for="username">Pseudo</label>
            <input id="username" name="username" autocomplete="username" required>
          </div>
          <div class="form-group">
            <label for="password">Mot de passe</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required>
            <div class="form-hint" id="password-hint">6 caractères minimum pour créer un compte</div>
          </div>
          <button type="submit" class="btn btn-primary" id="login-btn">Se connecter</button>
          <button type="button" class="btn btn-secondary" id="register-btn">Créer un compte</button>
          <div class="error-msg hidden" id="auth-error"></div>
        </form>
      </div>
    </div>`;

  const form = document.getElementById('auth-form');
  const errEl = document.getElementById('auth-error');
  const passwordEl = document.getElementById('password');

  const clearError = () => {
    errEl.textContent = '';
    errEl.classList.add('hidden');
  };

  form.querySelector('#username').addEventListener('input', clearError);
  passwordEl.addEventListener('input', clearError);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    doAuth('login');
  });

  document.getElementById('register-btn').onclick = () => {
    passwordEl.autocomplete = 'new-password';
    doAuth('register');
  };

  document.getElementById('login-btn').addEventListener('click', () => {
    passwordEl.autocomplete = 'current-password';
  });
}

function validateAuthInput(mode, username, password) {
  if (!username) return 'Choisis un pseudo';
  if (!password) return 'Entre un mot de passe';
  if (mode === 'register' && password.length < 6) {
    return 'Mot de passe trop court — 6 caractères minimum';
  }
  return null;
}

async function doAuth(mode) {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('auth-error');
  const loginBtn = document.getElementById('login-btn');
  const registerBtn = document.getElementById('register-btn');

  const validationError = validateAuthInput(mode, username, password);
  if (validationError) {
    errEl.textContent = validationError;
    errEl.classList.remove('hidden');
    return;
  }

  loginBtn.disabled = true;
  registerBtn.disabled = true;
  errEl.classList.add('hidden');

  try {
    const data = mode === 'login'
      ? await auth.login({ username, password })
      : await auth.register({ username, password, displayName: username });
    auth.setToken(data.token);
    state.user = data.user;
    await init();
  } catch (e) {
    errEl.textContent = e.message || 'Une erreur est survenue';
    errEl.classList.remove('hidden');
  } finally {
    loginBtn.disabled = false;
    registerBtn.disabled = false;
  }
}

function renderOnboarding() {
  app.innerHTML = `<div class="app-shell"><div class="section-card">
    <div class="section-head"><div class="jn">Bienvenue sur Matchday !</div></div>
    <p style="color:var(--ink-soft);font-size:14px;margin-bottom:16px">Crée un groupe ou rejoins-en un avec un code.</p>
    <button class="btn btn-primary" id="create-group-btn">Créer un groupe</button>
    <button class="btn btn-secondary" id="join-group-btn">Rejoindre un groupe</button>
  </div></div>`;

  document.getElementById('create-group-btn').onclick = renderCreateGroup;
  document.getElementById('join-group-btn').onclick = renderJoinGroup;
}

async function renderCreateGroup() {
  const allComps = await groups.competitions();
  app.innerHTML = `<div class="app-shell"><div class="section-card">
    <div class="section-head"><div class="jn">Nouveau groupe</div></div>
    <div class="form-group"><label>Nom du groupe</label><input id="group-name"></div>
    <label style="font-size:12px;font-weight:700;color:var(--ink-soft)">Championnats à suivre</label>
    <div class="comp-check" id="comp-checks">
      ${allComps.map(c => `<label><input type="checkbox" value="${c.id}"><span>${c.emoji} ${c.nom}</span></label>`).join('')}
    </div>
    <button class="btn btn-primary" id="submit-group">Créer</button>
    <div class="error-msg hidden" id="group-error"></div>
  </div></div>`;

  document.getElementById('submit-group').onclick = async () => {
    const name = document.getElementById('group-name').value.trim();
    const competitionIds = [...document.querySelectorAll('#comp-checks input:checked')].map(i => Number(i.value));
    if (!name || !competitionIds.length) {
      document.getElementById('group-error').textContent = 'Nom et au moins 1 championnat requis';
      document.getElementById('group-error').classList.remove('hidden');
      return;
    }
    try {
      const g = await groups.create({ name, competitionIds });
      state.myGroups = await groups.list();
      await loadGroup(g.id);
      renderApp();
    } catch (e) {
      document.getElementById('group-error').textContent = e.message;
      document.getElementById('group-error').classList.remove('hidden');
    }
  };
}

function renderJoinGroup() {
  app.innerHTML = `<div class="app-shell"><div class="section-card">
    <div class="section-head"><div class="jn">Rejoindre un groupe</div></div>
    <div class="form-group"><label>Code d'invitation</label><input id="invite-code" style="text-transform:uppercase"></div>
    <button class="btn btn-primary" id="join-submit">Rejoindre</button>
    <div class="error-msg hidden" id="join-error"></div>
  </div></div>`;

  document.getElementById('join-submit').onclick = async () => {
    try {
      const g = await groups.join(document.getElementById('invite-code').value.trim());
      state.myGroups = await groups.list();
      await loadGroup(g.id);
      renderApp();
    } catch (e) {
      document.getElementById('join-error').textContent = e.message;
      document.getElementById('join-error').classList.remove('hidden');
    }
  };
}

function renderHeaderAvatar(user) {
  return renderAvatarHtml(user?.avatar, user?.displayName, user?.profileColor, 'sm');
}

function headerHtml() {
  const color = state.user?.profileColor || '#6B3FD6';
  const notifOn = notificationsEnabled();
  const avatar = renderHeaderAvatar(state.user);
  const name = state.user?.displayName ?? 'Joueur';

  return `<div class="header">
    <div class="header-left">
      <div class="logo-blob">⚽</div>
      <div class="header-brand">
        <div class="title">Matchday</div>
        <button type="button" class="group-tag" id="switch-group">
          <span class="group-icon">👥</span>${state.group?.name ?? 'Groupe'}
        </button>
      </div>
    </div>
    <div class="header-right">
      <button type="button" class="header-profile-chip ${state.screen === 'profile' ? 'active' : ''}" id="header-profile" title="Mon profil">
        <span class="header-avatar" style="background:${color}">${avatar}</span>
        <span class="header-username">${name}</span>
      </button>
      <button type="button" class="header-icon-btn bell ${notifOn ? 'active' : ''}" id="header-notifications" title="Notifications — clic pour activer / retester">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      </button>
      <button type="button" class="header-icon-btn logout" id="header-logout" title="Déconnexion">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </button>
    </div>
  </div>`;
}

function attachHeaderEvents() {
  document.getElementById('header-profile')?.addEventListener('click', () => {
    closeGroupSwitcher();
    state.screen = 'profile';
    renderApp();
  });

  document.getElementById('header-notifications')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeGroupSwitcher();
    const btn = document.getElementById('header-notifications');
    openNotificationPanel(btn, {
      onEnabled: () => {
        btn.classList.add('active');
        startMatchReminders(state, goToMatches);
        renderApp();
      },
      onDisabled: () => {
        btn.classList.remove('active');
        stopMatchReminders();
        document.querySelectorAll('.reminder-banner').forEach(el => el.remove());
        renderApp();
      },
    });
  });

  document.getElementById('header-logout')?.addEventListener('click', () => {
    auth.logout();
    window.location.reload();
  });

  document.getElementById('switch-group')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openGroupSwitcher();
  });
}

function groupSwitcherHtml() {
  return `<div class="modal-overlay hidden" id="group-modal">
    <div class="modal-sheet">
      <div class="modal-head">
        <span class="jn">Changer de groupe</span>
        <button type="button" class="modal-close" id="close-group-modal" aria-label="Fermer">✕</button>
      </div>
      <div class="group-list" id="group-list"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="modal-join-group">Rejoindre un groupe</button>
        <button type="button" class="btn btn-primary" id="modal-create-group">Créer un groupe</button>
      </div>
    </div>
  </div>`;
}

async function openGroupSwitcher() {
  let modal = document.getElementById('group-modal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', groupSwitcherHtml());
    modal = document.getElementById('group-modal');
    document.getElementById('close-group-modal').onclick = closeGroupSwitcher;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeGroupSwitcher(); });
    document.getElementById('modal-join-group').onclick = () => { closeGroupSwitcher(); renderJoinGroup(); };
    document.getElementById('modal-create-group').onclick = () => { closeGroupSwitcher(); renderCreateGroup(); };
  }

  try {
    state.myGroups = await groups.list();
  } catch { /* garde la liste en cache */ }

  const list = document.getElementById('group-list');
  list.innerHTML = state.myGroups.map(g => `
    <button type="button" class="group-list-item ${g.id === state.group?.id ? 'active' : ''}" data-group-id="${g.id}">
      <span class="group-list-icon">👥</span>
      <span class="group-list-name">${g.name}</span>
      ${g.id === state.group?.id ? '<span class="group-list-badge">Actif</span>' : ''}
    </button>
  `).join('');

  list.querySelectorAll('[data-group-id]').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.groupId);
      if (id === state.group?.id) { closeGroupSwitcher(); return; }
      await loadGroup(id);
      closeGroupSwitcher();
      showToast(`Groupe « ${state.group.name} »`);
      renderApp();
    };
  });

  modal.classList.remove('hidden');
}

function closeGroupSwitcher() {
  document.getElementById('group-modal')?.classList.add('hidden');
}

function compPillsHtml() {
  if (state.competitions.length <= 1) return '';
  return `<div class="comp-grid">${state.competitions.map(c => {
    const cc = compColors(c.code);
    const active = c.id === state.activeComp ? `active ${cc.cls}` : '';
    const style = c.id === state.activeComp ? '' : '';
    return `<button class="comp-pill ${active}" data-comp="${c.id}" style="${c.id === state.activeComp ? `background:${c.couleur};color:white` : ''}">${c.emoji ?? ''} ${c.nom}</button>`;
  }).join('')}</div>`;
}

function navHtml() {
  const items = [
    { id: 'matches', icon: '⊞', label: 'Matchs' },
    { id: 'championships', icon: '🏆', label: 'Championnats' },
    { id: 'standings', icon: '≡', label: 'Classement' },
    { id: 'chat', icon: '◌', label: 'Chat' },
    { id: 'seasonxi', icon: '⚽', label: 'Mon 11' },
    { id: 'profile', icon: '○', label: 'Profil' },
  ];
  return `<div class="bottom-nav">${items.map(i =>
    `<button class="nav-item ${state.screen === i.id ? 'active' : ''}" data-nav="${i.id}">
      <div>${i.icon}</div>${i.label}
    </button>`).join('')}</div>`;
}

async function renderApp() {
  app.innerHTML = `<div class="app-shell">
    ${headerHtml()}
    ${state.screen === 'matches' || state.screen === 'standings' || state.screen === 'championships' ? compPillsHtml() : ''}
    <div id="screen-content"></div>
  </div>${navHtml()}`;

  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.onclick = () => { state.screen = btn.dataset.nav; renderApp(); };
  });
  document.querySelectorAll('[data-comp]').forEach(btn => {
    btn.onclick = () => { state.activeComp = Number(btn.dataset.comp); renderApp(); };
  });

  attachHeaderEvents();

  const content = document.getElementById('screen-content');
  switch (state.screen) {
    case 'matches': await renderMatches(content); break;
    case 'championships': await renderChampionships(content, state); break;
    case 'standings': await renderStandings(content); break;
    case 'chat': await renderChat(content); break;
    case 'seasonxi': await renderSeasonXi(content, state); break;
    case 'profile': await renderProfile(content, state, renderApp); break;
  }
}

async function renderMatches(el) {
  el.innerHTML = '<div class="empty-state">Chargement…</div>';
  try {
    const params = state.activeComp ? { competitionId: state.activeComp } : {};
    const matchList = await matches.list(state.group.id, params);

    if (!matchList.length) {
      el.innerHTML = `<div class="section-card"><div class="empty-state">Aucun match pour ce championnat.<br>La sync BSD se fait toutes les 6h.</div></div>`;
      return;
    }

    const byMatchday = {};
    for (const m of matchList) {
      const md = m.matchday ?? '?';
      (byMatchday[md] ??= []).push(m);
    }

    const sortedMatchdays = Object.entries(byMatchday).sort(([a], [b]) => {
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b), 'fr');
    });

    el.innerHTML = sortedMatchdays.map(([md, ms]) => {
      const comp = state.competitions.find(c => c.id === ms[0].competition_id) ?? ms[0];
      const cc = compColors(comp.code ?? comp.comp_code);
      const openMatches = ms.filter(m => !m.isLocked);
      const countdown = openMatches.find(m => formatCountdown(m.kickoff_at));
      const cd = countdown ? formatCountdown(countdown.kickoff_at) : '';
      const allLocked = openMatches.length === 0;

      return `<div class="section-card matchday-section ${allLocked ? 'matchday-past' : 'matchday-open'}" data-matchday="${md}">
        <div class="section-head">
          <div class="jn"><div class="comp-flag" style="background:${cc.bg};color:${cc.color}">${comp.code ?? comp.comp_code}</div>Journée ${md}<span class="season-tag">${ms[0].season ?? comp.saison_active ?? '2025-2026'}</span></div>
          ${cd ? `<div class="countdown-bubble">${cd}</div>` : allLocked ? '<div class="countdown-bubble locked">Terminée</div>' : ''}
        </div>
        ${ms.map(m => matchCardHtml(m, cc)).join('')}
      </div>`;
    }).join('');

    el.querySelectorAll('.score-pill input').forEach(input => {
      input.addEventListener('change', onScoreChange);
    });

    const firstOpen = el.querySelector('.matchday-section.matchday-open');
    firstOpen?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    el.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function matchCardHtml(m, cc) {
  const pred = m.prediction;
  const h = pred?.home_score ?? '';
  const a = pred?.away_score ?? '';
  const filled = h !== '' && a !== '';

  let bottom = 'à toi de jouer';
  let bottomClass = 'open';
  if (m.isLocked && pred?.points != null) {
    const labels = { exact: '🎯 +3 pts — score exact !', diff: '👏 +2 pts — bon écart', winner: '💪 +1 pt — bon vainqueur', miss: '😅 raté' };
    bottom = labels[pred.points_detail] ?? `${pred.points} pts`;
    bottomClass = pred.points > 0 ? 'points' : '';
  } else if (m.isLocked) {
    bottom = 'verrouillé';
    bottomClass = '';
  }

  return `<div class="match-card" data-match="${m.id}">
    <div class="match-top">
      <div class="team">${teamCrest(m.home_team_name, m.comp_code)}${m.home_team_name}</div>
      <div class="score-mid">
        <div class="score-pill ${filled ? 'filled' : ''}" style="${filled ? `color:${cc.color};border-color:${cc.color};background:${cc.bg}` : ''}">
          ${m.isLocked ? (h !== '' ? h : '–') : `<input type="number" min="0" max="20" data-side="home" data-match="${m.id}" value="${h}" placeholder="–">`}
        </div>
        <div class="score-pill ${filled ? 'filled' : ''}" style="${filled ? `color:${cc.color};border-color:${cc.color};background:${cc.bg}` : ''}">
          ${m.isLocked ? (a !== '' ? a : '–') : `<input type="number" min="0" max="20" data-side="away" data-match="${m.id}" value="${a}" placeholder="–">`}
        </div>
      </div>
      <div class="team right">${m.away_team_name}${teamCrest(m.away_team_name, m.comp_code)}</div>
    </div>
    <div class="match-bottom ${bottomClass}" style="${bottomClass === 'points' ? `color:${cc.color}` : ''}">${bottom}</div>
  </div>`;
}

async function onScoreChange(e) {
  const matchId = Number(e.target.dataset.match);
  const card = e.target.closest('.match-card');
  const home = card.querySelector('[data-side="home"]').value;
  const away = card.querySelector('[data-side="away"]').value;
  if (home === '' || away === '') return;
  try {
    await matches.predict(state.group.id, { matchId, homeScore: Number(home), awayScore: Number(away) });
    showToast('Pronostic enregistré ✓');
    renderApp();
  } catch (err) {
    showToast(err.message);
  }
}

async function renderStandings(el) {
  el.innerHTML = `<div class="tabs">
    <button class="tab ${state.standingsTab === 'general' ? 'active' : ''}" data-tab="general">Général</button>
    <button class="tab ${state.standingsTab === 'official' ? 'active' : ''}" data-tab="official">Championnat</button>
    <button class="tab ${state.standingsTab === 'stats' ? 'active' : ''}" data-tab="stats">Stats</button>
  </div><div id="standings-body"></div>`;

  el.querySelectorAll('[data-tab]').forEach(btn => {
    btn.onclick = () => { state.standingsTab = btn.dataset.tab; renderStandings(el); };
  });

  const body = document.getElementById('standings-body');
  const compId = state.activeComp;

  if (state.standingsTab === 'general') {
    const rows = await standings.general(state.group.id, compId);
    const activeComp = state.competitions.find(c => c.id === compId);
    const cc = activeComp ? compColors(activeComp.code) : compColors('L1');
    body.innerHTML = `<div class="section-card standings-card">
      <div class="section-head"><div class="jn">Classement</div></div>
      ${rows.map((r, i) => {
        const isMe = r.userId === state.user.id;
        return `<div class="row ${isMe ? 'me' : ''}" style="${isMe ? `background:${cc.bg}` : ''}">
          <div class="medal" style="${isMe ? `background:${cc.color};color:white` : ''}">${i < 3 ? ['🥇','🥈','🥉'][i] : i + 1}</div>
          <div class="name" style="${isMe ? `color:${cc.color}` : ''}">${r.displayName}
            ${r.xiPoints ? `<div class="sub-pts">11 de saison : +${r.xiPoints} pts</div>` : ''}
          </div>
          <div class="pts">${r.totalPoints} pts</div>
        </div>`;
      }).join('')}
    </div>`;
  } else if (state.standingsTab === 'official' && compId) {
    const rows = await standings.official(state.group.id, compId);
    body.innerHTML = `<div class="section-card"><div class="section-head"><div class="jn">Classement officiel</div></div>
      ${rows.length ? rows.map(r => `<div class="row"><div class="medal">${r.position}</div><div class="name">${r.team_name}</div><div class="pts">${r.points} pts</div></div>`).join('') : '<div class="empty-state">Pas encore de données</div>'}
    </div>`;
  } else if (state.standingsTab === 'stats') {
    const stats = await standings.stats(state.group.id);
    body.innerHTML = `<div class="section-card"><div class="section-head"><div class="jn">Évolution</div></div>
      <div class="empty-state">${stats.timeline?.length ?? 0} journées enregistrées</div>
    </div>`;
  }
}

async function renderChat(el) {
  const messages = await chat.list(state.group.id);
  el.innerHTML = `<div class="section-card" style="min-height:400px;display:flex;flex-direction:column">
    <div id="chat-msgs" style="flex:1;overflow-y:auto;max-height:360px">
      ${messages.length ? messages.map(m => {
        const mine = m.user_id === state.user.id;
        const bg = mine ? (state.user.profileColor || 'var(--pl)') : '';
        return `<div style="margin-bottom:12px">
          <div class="chat-meta">${m.display_name}</div>
          <div class="chat-bubble ${mine ? 'mine' : 'other'}" style="${mine ? `background:${bg}` : ''}">${m.content}</div>
        </div>`;
      }).join('') : '<div class="empty-state">Aucun message — lance la conversation !</div>'}
    </div>
    <div class="chat-input-row">
      <input id="chat-input" placeholder="Ton message…">
      <button class="btn btn-primary" style="width:auto;padding:12px 18px" id="chat-send">→</button>
    </div>
  </div>`;

  document.getElementById('chat-send').onclick = async () => {
    const input = document.getElementById('chat-input');
    if (!input.value.trim()) return;
    await chat.send(state.group.id, input.value.trim());
    renderChat(el);
  };
}

init();

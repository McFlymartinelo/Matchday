import { auth, groups, matches, showToast, compId, sameCompId, loadSavedCompId, saveCompId, escapeHtml } from './api.js?v=54';
import { renderChatScreen } from './chatUi.js';
import './theme.js';
import { renderAvatarHtml } from './avatars.js';
import { renderProfile } from './profile.js';
import { renderChampionships } from './championships.js?v=51';
import { renderSeasonXi } from './seasonXi.js';
import { renderStandingsScreen, compPillsHtml } from './standingsUi.js';
import { renderMatches, resetMatchesUi } from './matchesUi.js?v=53';
import { syncPushIfEnabled, notificationsEnabled, openNotificationPanel, parseNavFromPayload, stashNotificationDeepLinkFromUrl, consumePendingNav, registerPushHandlers, navigateToMatchDeepLink } from './notifications.js';
import { startMatchReminders, stopMatchReminders, handlePushPayload } from './reminders.js';
import { renderAuthScreen, renderPublicGroupOptions, formatMemberCount } from './authUi.js?v=3';

const state = {
  user: null,
  group: null,
  myGroups: [],
  competitions: [],
  activeComp: null,
  screen: 'matches',
  matchesTab: 'pronostiquer',
  standingsTab: 'general',
  standingsCompId: null,
  duelUserA: null,
  duelUserB: null,
  scrollToMatchId: null,
};

const app = document.getElementById('app');

export async function init() {
  if (!auth.isLoggedIn()) {
    stashNotificationDeepLinkFromUrl();
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
    await handleInviteDeepLink();
    const pendingNav = consumePendingNav();
    if (pendingNav) await applyPendingNav(pendingNav);
    else await handleNotificationDeepLink();
    await syncPushIfEnabled();
    startMatchReminders(state, openMatchFromNotif);
    renderApp();
  } catch (err) {
    auth.logout();
    renderAuth();
    throw err;
  }
}

async function pickCompetitionWithMatches(groupId, competitions) {
  if (!competitions.length) return null;
  try {
    const list = await matches.list(groupId, {});
    const open = list.filter(m => !m.isLocked);
    if (open.length) {
      open.sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at));
      return compId(open[0].competition_id);
    }
    if (list.length) return compId(list[0].competition_id);
  } catch { /* ignore */ }
  return compId(competitions[0]?.id);
}

function activeCompStorageKey(groupId) {
  return `matchday_active_comp_${groupId}`;
}

function setActiveComp(competitionId) {
  const id = compId(competitionId);
  if (id == null) return;
  state.activeComp = id;
  if (state.group?.id) saveCompId(activeCompStorageKey(state.group.id), id);
}

async function loadGroup(groupId) {
  stopMatchReminders();
  state.group = await groups.get(groupId);
  state.competitions = state.group.competitions ?? [];
  const saved = loadSavedCompId(activeCompStorageKey(groupId), state.competitions);
  state.activeComp = saved ?? await pickCompetitionWithMatches(groupId, state.competitions);
  if (state.activeComp != null) saveCompId(activeCompStorageKey(groupId), state.activeComp);
  localStorage.setItem('matchday_group', groupId);
  if (notificationsEnabled()) {
    startMatchReminders(state, openMatchFromNotif);
  }
}

async function applyPendingNav(nav) {
  if (!nav) return false;

  if (nav.groupId && state.myGroups.some(g => g.id === nav.groupId) && state.group?.id !== nav.groupId) {
    await loadGroup(nav.groupId);
  }
  if (nav.competitionId) setActiveComp(nav.competitionId);
  state.screen = 'matches';
  state.scrollToMatchId = nav.matchId ?? null;
  return true;
}

async function goToMatch(nav) {
  const target = parseNavFromPayload(nav) ?? consumePendingNav();
  if (!target?.matchId && !target?.groupId && !target?.competitionId) {
    state.screen = 'matches';
    state.scrollToMatchId = null;
    await renderApp();
    return;
  }

  await applyPendingNav(target);
  await renderApp();

  if (target.matchId && !document.querySelector(`.match-card[data-match="${target.matchId}"]`)) {
    try {
      const all = await matches.list(state.group.id, {});
      const found = all.find(m => m.id === target.matchId);
      if (found) {
        setActiveComp(found.competition_id);
        state.scrollToMatchId = target.matchId;
        await renderApp();
      }
    } catch { /* ignore */ }
  }
}

function goToMatches() {
  goToMatch(null);
}

async function handleNotificationDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const matchId = params.get('match');
  const screen = params.get('screen');
  if (!matchId && screen !== 'matches') return;

  history.replaceState({}, '', window.location.pathname);
  await applyPendingNav({
    matchId: matchId ? Number(matchId) : null,
    groupId: params.get('group') ? Number(params.get('group')) : null,
    competitionId: params.get('comp') ? Number(params.get('comp')) : null,
  });
}

function setAuthPage(on) {
  document.body.classList.toggle('auth-page', on);
}

function renderAuth() {
  renderAuthScreen({
    setAuthPage,
    onLoggedIn: async (data) => {
      auth.setToken(data.token);
      state.user = data.user;
      setAuthPage(false);
      sessionStorage.removeItem('matchday_pending_join');
      await init();
    },
  });
}

function renderOnboarding() {
  setAuthPage(false);
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
    <label class="comp-check" style="margin-top:12px">
      <input type="checkbox" id="group-public" checked>
      <span>Groupe public (visible à l'inscription)</span>
    </label>
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
      const g = await groups.create({
        name,
        competitionIds,
        isPublic: document.getElementById('group-public').checked,
      });
      state.myGroups = await groups.list();
      await loadGroup(g.id);
      renderApp();
    } catch (e) {
      document.getElementById('group-error').textContent = e.message;
      document.getElementById('group-error').classList.remove('hidden');
    }
  };
}

async function renderJoinGroup() {
  setAuthPage(false);
  let publicGroups = [];
  try {
    publicGroups = await groups.publicList();
  } catch { /* ignore */ }

  const joinUi = { mode: publicGroups.length ? 'pick' : 'code' };

  app.innerHTML = `<div class="app-shell"><div class="section-card">
    <div class="section-head"><div class="jn">Rejoindre un groupe</div></div>
    ${publicGroups.length ? `
      <div class="auth-subtabs" style="margin-bottom:12px">
        <button type="button" class="auth-subtab ${joinUi.mode === 'pick' ? 'active' : ''}" data-join="pick">Choisir un groupe</button>
        <button type="button" class="auth-subtab ${joinUi.mode === 'code' ? 'active' : ''}" data-join="code">Code d'accès</button>
      </div>
      <div id="join-pick" class="${joinUi.mode === 'pick' ? '' : 'hidden'}">
        ${renderPublicGroupOptions(publicGroups)}
      </div>
    ` : ''}
    <div id="join-code" class="${joinUi.mode === 'code' ? '' : 'hidden'}">
      <div class="form-group"><label>Code d'invitation</label><input id="invite-code" style="text-transform:uppercase"></div>
    </div>
    <button class="btn btn-primary" id="join-submit">Rejoindre</button>
    <div class="error-msg hidden" id="join-error"></div>
  </div></div>`;

  document.querySelectorAll('[data-join]').forEach(btn => {
    btn.onclick = () => {
      joinUi.mode = btn.dataset.join;
      document.querySelectorAll('[data-join]').forEach(b => b.classList.toggle('active', b.dataset.join === joinUi.mode));
      document.getElementById('join-pick')?.classList.toggle('hidden', joinUi.mode !== 'pick');
      document.getElementById('join-code')?.classList.toggle('hidden', joinUi.mode !== 'code');
    };
  });

  document.getElementById('join-submit').onclick = async () => {
    try {
      let g;
      if (joinUi.mode === 'pick') {
        const groupId = document.getElementById('public-group')?.value;
        if (!groupId) throw new Error('Choisis un groupe');
        g = await groups.join({ groupId: Number(groupId) });
      } else {
        const code = document.getElementById('invite-code').value.trim();
        if (!code) throw new Error('Entre un code d\'accès');
        g = await groups.join({ inviteCode: code });
      }
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
      <div class="logo-blob"><img src="/icons/icon-192.png?v=6" alt="" class="header-app-icon"></div>
      <div class="header-brand">
        <div class="title">Matchday</div>
        <button type="button" class="group-tag" id="switch-group">
          <span class="group-icon">👥</span>${escapeHtml(state.group?.name ?? 'Groupe')}
        </button>
      </div>
    </div>
    <div class="header-right">
      <button type="button" class="header-profile-chip ${state.screen === 'profile' ? 'active' : ''}" id="header-profile" title="Mon profil">
        <span class="header-avatar" style="background:${color}">${avatar}</span>
        <span class="header-username">${escapeHtml(name)}</span>
      </button>
      <button type="button" class="header-icon-btn bell ${notifOn ? 'active' : ''}" id="header-notifications" title="Notifications — clic pour activer / retester">
        <img src="/icons/icon-notif.svg?v=5" alt="" class="header-icon-img" width="18" height="18">
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
        startMatchReminders(state, openMatchFromNotif);
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

function getInviteCode(group) {
  return (group?.inviteCode || group?.invite_code || '').toUpperCase();
}

function buildInviteLink(code) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('join', code);
  return url.toString();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copié !');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Copié !');
  }
}

async function handleInviteDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get('join') || params.get('invite') || '').trim().toUpperCase();
  if (!code) return;

  history.replaceState({}, '', window.location.pathname);
  try {
    const g = await groups.join({ inviteCode: code });
    state.myGroups = await groups.list();
    await loadGroup(g.id);
    showToast(`Bienvenue dans « ${g.name} » !`);
    renderApp();
  } catch (e) {
    showToast(e.message || 'Code invalide');
    openGroupSwitcher(code);
  }
}

function openInviteShareModal(group) {
  document.getElementById('invite-share-modal')?.remove();
  const code = getInviteCode(group);
  if (!code) return;
  const link = buildInviteLink(code);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="invite-share-modal">
      <div class="modal-sheet invite-share-sheet">
        <div class="modal-head">
          <span class="jn">Inviter — ${escapeHtml(group.name)}</span>
          <button type="button" class="modal-close" id="close-invite-share" aria-label="Fermer">✕</button>
        </div>
        <p class="invite-share-code">Code : <strong>${code}</strong></p>
        <img src="${qrUrl}" alt="" class="invite-qr" width="180" height="180">
        <p class="invite-share-link">${escapeHtml(link)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="copy-invite-link">Copier le lien</button>
          <button type="button" class="btn btn-primary" id="native-share-invite">Partager</button>
        </div>
      </div>
    </div>
  `);

  const modal = document.getElementById('invite-share-modal');
  const close = () => modal.remove();
  document.getElementById('close-invite-share').onclick = close;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.getElementById('copy-invite-link').onclick = () => copyText(link);
  document.getElementById('native-share-invite').onclick = async () => {
    const shareData = {
      title: 'Matchday',
      text: `Rejoins mon groupe « ${group.name} » sur Matchday ! Code : ${code}`,
      url: link,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch { /* annulé */ }
    } else {
      await copyText(link);
    }
  };
}

function renderGroupCard(g) {
  const isActive = g.id === state.group?.id;
  const code = getInviteCode(g);
  const shareBlock = code ? `
      <div class="group-share">
        <span class="group-code">Code : ${code}</span>
        <div class="group-share-actions">
          <button type="button" class="group-share-btn" data-copy-code="${code}">📋 Copier</button>
          <button type="button" class="group-share-btn" data-share-group="${g.id}">🔗 Lien + QR</button>
        </div>
        ${g.isPublic ? '<span class="group-public-hint">Groupe public — aussi visible à l\'inscription</span>' : ''}
      </div>
    ` : '';

  return `
    <div class="group-card ${isActive ? 'active' : ''}">
      <button type="button" class="group-card-select" data-group-id="${g.id}">
        <div class="group-card-header">
          <span class="group-list-name">${escapeHtml(g.name)}</span>
          ${isActive ? '<span class="group-list-badge">Actif</span>' : ''}
        </div>
        <span class="group-card-meta">${formatMemberCount(g.memberCount)}</span>
      </button>
      ${shareBlock}
    </div>
  `;
}

function groupSwitcherHtml() {
  return `<div class="modal-overlay hidden" id="group-modal">
    <div class="modal-sheet">
      <div class="modal-head">
        <span class="jn">Mes groupes</span>
        <button type="button" class="modal-close" id="close-group-modal" aria-label="Fermer">✕</button>
      </div>
      <div class="group-list" id="group-list"></div>
      <div class="modal-section">
        <span class="modal-section-label">Rejoindre avec un code</span>
        <div class="modal-inline-form">
          <input id="modal-join-code" placeholder="EX. CDM7X2K" autocomplete="off">
          <button type="button" class="btn btn-primary" id="modal-join-submit">Rejoindre</button>
        </div>
        <div class="error-msg hidden" id="modal-join-error"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="modal-create-group">Créer un groupe</button>
      </div>
    </div>
  </div>`;
}

async function openGroupSwitcher(prefillCode = '') {
  let modal = document.getElementById('group-modal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', groupSwitcherHtml());
    modal = document.getElementById('group-modal');
    document.getElementById('close-group-modal').onclick = closeGroupSwitcher;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeGroupSwitcher(); });
    document.getElementById('modal-create-group').onclick = () => { closeGroupSwitcher(); renderCreateGroup(); };
    document.getElementById('modal-join-submit').onclick = async () => {
      const errEl = document.getElementById('modal-join-error');
      const code = document.getElementById('modal-join-code').value.trim();
      errEl.classList.add('hidden');
      if (!code) {
        errEl.textContent = 'Entre un code d\'invitation';
        errEl.classList.remove('hidden');
        return;
      }
      try {
        const g = await groups.join({ inviteCode: code });
        state.myGroups = await groups.list();
        await loadGroup(g.id);
        closeGroupSwitcher();
        showToast(`Groupe « ${g.name} » rejoint !`);
        renderApp();
      } catch (e) {
        errEl.textContent = e.message || 'Code invalide';
        errEl.classList.remove('hidden');
      }
    };
  }

  try {
    state.myGroups = await groups.list();
  } catch { /* garde la liste en cache */ }

  const list = document.getElementById('group-list');
  list.innerHTML = state.myGroups.map(renderGroupCard).join('');

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

  list.querySelectorAll('[data-copy-code]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      copyText(btn.dataset.copyCode);
    };
  });

  list.querySelectorAll('[data-share-group]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const group = state.myGroups.find(g => g.id === Number(btn.dataset.shareGroup));
      if (group) openInviteShareModal(group);
    };
  });

  const joinInput = document.getElementById('modal-join-code');
  if (joinInput) joinInput.value = prefillCode;
  document.getElementById('modal-join-error')?.classList.add('hidden');

  modal.classList.remove('hidden');
}

function closeGroupSwitcher() {
  document.getElementById('group-modal')?.classList.add('hidden');
}

function navHtml() {
  const items = [
    { id: 'matches', image: '/icons/nav-matches.svg?v=5', label: 'Matchs' },
    { id: 'championships', image: '/icons/nav-league.svg?v=5', label: 'Championnats' },
    { id: 'standings', image: '/icons/nav-stat.svg?v=5', label: 'Classement' },
    { id: 'chat', image: '/icons/nav-chat.svg?v=5', label: 'Chat' },
    { id: 'seasonxi', icon: '⚽', label: 'Mon 11' },
    { id: 'profile', image: '/icons/nav-user.svg?v=5', label: 'Profil' },
  ];
  return `<div class="bottom-nav">${items.map(i =>
    `<button class="nav-item ${state.screen === i.id ? 'active' : ''}" data-nav="${i.id}">
      <div>${i.image
        ? `<img src="${i.image}" alt="" class="nav-icon-img" width="24" height="24">`
        : i.icon}</div>${i.label}
    </button>`).join('')}</div>`;
}

async function renderApp() {
  setAuthPage(false);
  app.innerHTML = `<div class="app-shell">
    ${headerHtml()}
    ${state.screen === 'matches' || state.screen === 'championships' ? compPillsHtml(state) : ''}
    <div id="screen-content"></div>
  </div>${navHtml()}`;

  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.onclick = () => {
      resetMatchesUi();
      state.screen = btn.dataset.nav;
      renderApp();
    };
  });
  document.querySelectorAll('[data-comp]').forEach(btn => {
    btn.onclick = () => {
      if (state.activeComp != null && sameCompId(state.activeComp, btn.dataset.comp)) {
        state.activeComp = null;
      } else {
        setActiveComp(btn.dataset.comp);
      }
      renderApp();
    };
  });

  requestAnimationFrame(() => {
    document.querySelector('.comp-pill.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  });

  attachHeaderEvents();

  const content = document.getElementById('screen-content');
  switch (state.screen) {
    case 'matches': await renderMatches(content, state, { setActiveComp, renderApp }); break;
    case 'championships': await renderChampionships(content, state); break;
    case 'standings': await renderStandingsScreen(content, state); break;
    case 'chat': await renderChatScreen(content, state); break;
    case 'seasonxi': await renderSeasonXi(content, state); break;
    case 'profile': await renderProfile(content, state, renderApp); break;
  }
}


function openMatchFromNotif(nav) {
  if (parseNavFromPayload(nav)?.matchId) {
    navigateToMatchDeepLink(nav);
    return;
  }
  goToMatch(nav);
}

registerPushHandlers({
  onNav: openMatchFromNotif,
  onPush: (payload) => {
    if (state.user && state.group) handlePushPayload(payload, state, openMatchFromNotif);
  },
});

init();
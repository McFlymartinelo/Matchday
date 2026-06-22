import { auth, groups, matches, showToast, compColors, teamCrest, formatCountdown, initials, buildTeamLogoMap, normTeamName } from './api.js';
import { renderChatScreen } from './chatUi.js';
import './theme.js';
import { renderAvatarHtml } from './avatars.js';
import { renderProfile } from './profile.js';
import { renderChampionships } from './championships.js';
import { renderSeasonXi } from './seasonXi.js';
import { renderStandingsScreen, compPillsHtml } from './standingsUi.js';
import { syncPushIfEnabled, notificationsEnabled, openNotificationPanel, parseNavFromPayload, stashNotificationDeepLinkFromUrl, consumePendingNav, registerPushHandlers, navigateToMatchDeepLink } from './notifications.js';
import { startMatchReminders, stopMatchReminders, handlePushPayload } from './reminders.js';

const state = {
  user: null,
  group: null,
  myGroups: [],
  competitions: [],
  activeComp: null,
  screen: 'matches',
  standingsTab: 'general',
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
      return open[0].competition_id;
    }
    if (list.length) return list[0].competition_id;
  } catch { /* ignore */ }
  return competitions[0]?.id ?? null;
}

async function loadGroup(groupId) {
  stopMatchReminders();
  state.group = await groups.get(groupId);
  state.competitions = state.group.competitions ?? [];
  state.activeComp = await pickCompetitionWithMatches(groupId, state.competitions);
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
  if (nav.competitionId) state.activeComp = nav.competitionId;
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
        state.activeComp = found.competition_id;
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

function scrollToMatchCard(matchId) {
  const card = document.querySelector(`.match-card[data-match="${matchId}"]`);
  if (!card) return false;
  card.classList.add('match-card-highlight');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.querySelector('input[data-side="home"]')?.focus({ preventScroll: true });
  setTimeout(() => card.classList.remove('match-card-highlight'), 5000);
  return true;
}

async function ensureMatchVisible(matchId) {
  if (!matchId || !state.group?.id) return false;

  let list = await matches.list(state.group.id, state.activeComp ? { competitionId: state.activeComp } : {});
  if (list.some(m => m.id === matchId)) return true;

  const all = await matches.list(state.group.id, {});
  const found = all.find(m => m.id === matchId);
  if (!found) return false;

  state.activeComp = found.competition_id;
  return true;
}

async function focusMatchAfterRender(matchId, attempt = 0) {
  if (!matchId) return;
  if (scrollToMatchCard(matchId)) return;

  if (attempt >= 4) {
    showToast('Match introuvable — calendrier peut-être expiré', 'error');
    return;
  }

  if (attempt === 1) {
    const ok = await ensureMatchVisible(matchId);
    if (ok) {
      state.scrollToMatchId = matchId;
      await renderApp();
      return;
    }
  }

  setTimeout(() => focusMatchAfterRender(matchId, attempt + 1), 200);
}

function setAuthPage(on) {
  document.body.classList.toggle('auth-page', on);
}

function formatMemberCount(n) {
  const count = Number(n) || 0;
  return `${count} membre${count > 1 ? 's' : ''}`;
}

function renderPublicGroupOptions(publicGroups) {
  if (!publicGroups.length) {
    return `<div class="auth-empty-groups">Aucun groupe public pour l'instant</div>`;
  }
  return `<select id="public-group" class="auth-select">
    ${publicGroups.map(g => `<option value="${g.id}">${g.name} (${formatMemberCount(g.memberCount)})</option>`).join('')}
  </select>`;
}

async function renderAuth() {
  setAuthPage(true);

  let publicGroups = [];
  try {
    publicGroups = await groups.publicList();
  } catch {
    /* liste vide si API indisponible */
  }

  const authUi = {
    mode: 'login',
    joinMode: 'pick',
  };

  const pendingJoin = (
    new URLSearchParams(window.location.search).get('join')
    || new URLSearchParams(window.location.search).get('invite')
    || sessionStorage.getItem('matchday_pending_join')
    || ''
  ).trim().toUpperCase();
  if (pendingJoin) {
    authUi.mode = 'register';
    authUi.joinMode = 'code';
    sessionStorage.setItem('matchday_pending_join', pendingJoin);
    history.replaceState({}, '', window.location.pathname);
  }

  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-wrap">
        <div class="auth-hero">🏆</div>
        <h1 class="auth-title">Matchday</h1>
        <p class="auth-sub">Connecte-toi pour jouer</p>

        <div class="auth-tabs">
          <button type="button" class="auth-tab active" data-mode="login">Connexion</button>
          <button type="button" class="auth-tab" data-mode="register">Inscription</button>
        </div>

        <form id="auth-form" class="auth-form" novalidate>
          <input id="username" class="auth-input" name="username" autocomplete="username" placeholder="Pseudo" required>
          <input id="password" class="auth-input" name="password" type="password" autocomplete="current-password" placeholder="Mot de passe" required>

          <div id="join-section" class="auth-join-block hidden">
            <div class="auth-section-label">Rejoindre un groupe</div>
            <div class="auth-subtabs">
              <button type="button" class="auth-subtab active" data-join="pick">Choisir un groupe</button>
              <button type="button" class="auth-subtab" data-join="code">Code d'accès</button>
            </div>
            <div id="join-pick">${renderPublicGroupOptions(publicGroups)}</div>
            <div id="join-code" class="hidden">
              <input id="invite-code" class="auth-input" placeholder="EX. CDM7X2K" autocomplete="off" style="text-transform:uppercase">
            </div>
          </div>

          <button type="submit" class="auth-submit" id="auth-submit">Se connecter</button>
          <div class="error-msg hidden" id="auth-error"></div>
        </form>
      </div>
    </div>`;

  const form = document.getElementById('auth-form');
  const errEl = document.getElementById('auth-error');
  const passwordEl = document.getElementById('password');
  const joinSection = document.getElementById('join-section');
  const joinPick = document.getElementById('join-pick');
  const joinCode = document.getElementById('join-code');
  const submitBtn = document.getElementById('auth-submit');

  const clearError = () => {
    errEl.textContent = '';
    errEl.classList.add('hidden');
  };

  const syncAuthUi = () => {
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === authUi.mode);
    });
    document.querySelectorAll('.auth-subtab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.join === authUi.joinMode);
    });

    const isRegister = authUi.mode === 'register';
    joinSection.classList.toggle('hidden', !isRegister);
    joinPick.classList.toggle('hidden', !isRegister || authUi.joinMode !== 'pick');
    joinCode.classList.toggle('hidden', !isRegister || authUi.joinMode !== 'code');
    submitBtn.textContent = isRegister ? "S'inscrire" : 'Se connecter';
    passwordEl.autocomplete = isRegister ? 'new-password' : 'current-password';
    const inviteEl = document.getElementById('invite-code');
    if (inviteEl && pendingJoin && isRegister && authUi.joinMode === 'code') {
      inviteEl.value = pendingJoin;
    }
  };

  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.onclick = () => {
      authUi.mode = tab.dataset.mode;
      clearError();
      syncAuthUi();
    };
  });

  document.querySelectorAll('.auth-subtab').forEach(tab => {
    tab.onclick = () => {
      authUi.joinMode = tab.dataset.join;
      clearError();
      syncAuthUi();
    };
  });

  form.querySelector('#username').addEventListener('input', clearError);
  passwordEl.addEventListener('input', clearError);
  document.getElementById('invite-code')?.addEventListener('input', clearError);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    doAuth(authUi);
  });

  syncAuthUi();
}

function validateAuthInput(mode, username, password) {
  if (!username) return 'Choisis un pseudo';
  if (!password) return 'Entre un mot de passe';
  if (mode === 'register' && password.length < 6) {
    return 'Mot de passe trop court — 6 caractères minimum';
  }
  return null;
}

async function doAuth(authUi) {
  const mode = authUi.mode;
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('auth-error');
  const submitBtn = document.getElementById('auth-submit');

  const validationError = validateAuthInput(mode, username, password);
  if (validationError) {
    errEl.textContent = validationError;
    errEl.classList.remove('hidden');
    return;
  }

  submitBtn.disabled = true;
  errEl.classList.add('hidden');

  try {
    const data = mode === 'login'
      ? await auth.login({ username, password })
      : await auth.register({ username, password, displayName: username });
    auth.setToken(data.token);
    state.user = data.user;

    if (mode === 'register') {
      if (authUi.joinMode === 'pick') {
        const groupId = document.getElementById('public-group')?.value;
        if (groupId) await groups.join({ groupId: Number(groupId) });
      } else {
        const code = document.getElementById('invite-code')?.value.trim();
        if (code) await groups.join({ inviteCode: code });
      }
    }

    setAuthPage(false);
    sessionStorage.removeItem('matchday_pending_join');
    await init();
  } catch (e) {
    errEl.textContent = e.message || 'Une erreur est survenue';
    errEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
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
          <span class="jn">Inviter — ${group.name}</span>
          <button type="button" class="modal-close" id="close-invite-share" aria-label="Fermer">✕</button>
        </div>
        <p class="invite-share-code">Code : <strong>${code}</strong></p>
        <img src="${qrUrl}" alt="" class="invite-qr" width="180" height="180">
        <p class="invite-share-link">${link}</p>
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
          <span class="group-list-name">${g.name}</span>
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

function resolveBsdTeamId(match, side, logoMap) {
  const direct = side === 'home' ? match.home_bsd_team_id : match.away_bsd_team_id;
  if (direct) return Number(direct);
  const name = side === 'home' ? match.home_team_name : match.away_team_name;
  return logoMap.get(normTeamName(name)) ?? null;
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
    case 'standings': await renderStandingsScreen(content, state); break;
    case 'chat': await renderChatScreen(content, state); break;
    case 'seasonxi': await renderSeasonXi(content, state); break;
    case 'profile': await renderProfile(content, state, renderApp); break;
  }
}

async function renderMatches(el) {
  el.innerHTML = '<div class="empty-state">Chargement…</div>';
  try {
    const pendingScrollId = state.scrollToMatchId;
    if (pendingScrollId) await ensureMatchVisible(pendingScrollId);

    const params = state.activeComp ? { competitionId: state.activeComp } : {};
    const [matchList, logoMap] = await Promise.all([
      matches.list(state.group.id, params),
      buildTeamLogoMap(state.group.id),
    ]);

    if (!matchList.length) {
      el.innerHTML = `<div class="section-card"><div class="empty-state">Aucun calendrier disponible pour ce championnat.<br>La sync BSD se fait toutes les 6h.</div></div>`;
      return;
    }

    const comp = state.competitions.find(c => c.id === state.activeComp) ?? matchList[0];
    const season = matchList[0].season ?? comp.saisonActive ?? comp.saison_active ?? '2025-2026';
    const calendarClosed = matchList.every(m => m.calendarClosed ?? m.isLocked);
    const closedBanner = calendarClosed
      ? `<div class="calendar-closed-banner">
          <strong>Saison ${season} — calendrier fermé</strong>
          <span>Le calendrier 2026-2027 n'est pas encore disponible sur BSD. Tu peux consulter la saison passée ci-dessous, mais les pronostics sont terminés.</span>
        </div>`
      : '';

    const byMatchday = {};
    for (const m of matchList) {
      const season = m.season ?? m.saison_active ?? '2025-2026';
      const md = m.matchday ?? '?';
      const key = `${season}|${md}`;
      (byMatchday[key] ??= []).push(m);
    }

    const sortedMatchdays = Object.entries(byMatchday).sort(([a], [b]) => {
      const [seasonA, mdA] = a.split('|');
      const [seasonB, mdB] = b.split('|');
      if (seasonA !== seasonB) return seasonA.localeCompare(seasonB, 'fr');
      const na = Number(mdA);
      const nb = Number(mdB);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return String(mdA).localeCompare(String(mdB), 'fr');
    });

    el.innerHTML = `${closedBanner}${sortedMatchdays.map(([key, ms]) => {
      const [season, md] = key.split('|');
      const comp = state.competitions.find(c => c.id === ms[0].competition_id) ?? ms[0];
      const cc = compColors(comp.code ?? comp.comp_code);
      const openMatches = ms.filter(m => !m.isLocked);
      const countdown = openMatches.find(m => formatCountdown(m.kickoff_at));
      const cd = countdown ? formatCountdown(countdown.kickoff_at) : '';
      const allLocked = openMatches.length === 0;

      return `<div class="section-card matchday-section ${allLocked ? 'matchday-past' : 'matchday-open'}" data-matchday="${md}" data-season="${season}">
        <div class="section-head">
          <div class="jn"><div class="comp-flag" style="background:${cc.bg};color:${cc.color}">${comp.code ?? comp.comp_code}</div>Journée ${md}<span class="season-tag">${season}</span></div>
          ${cd ? `<div class="countdown-bubble">${cd}</div>` : allLocked ? `<div class="countdown-bubble locked">${calendarClosed ? 'Fermée' : 'Terminée'}</div>` : ''}
        </div>
        ${ms.map(m => matchCardHtml(m, cc, logoMap)).join('')}
      </div>`;
    }).join('')}`;

    el.querySelectorAll('.score-pill input').forEach(input => {
      input.addEventListener('change', onScoreChange);
    });

    if (state.scrollToMatchId) {
      const id = state.scrollToMatchId;
      state.scrollToMatchId = null;
      focusMatchAfterRender(id);
    } else {
      const firstOpen = el.querySelector('.matchday-section.matchday-open');
      firstOpen?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (e) {
    el.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function matchCardHtml(m, cc, logoMap) {
  const pred = m.prediction;
  const h = pred?.home_score ?? '';
  const a = pred?.away_score ?? '';
  const filled = h !== '' && a !== '';
  const homeTeamId = resolveBsdTeamId(m, 'home', logoMap);
  const awayTeamId = resolveBsdTeamId(m, 'away', logoMap);

  let bottom = 'à toi de jouer';
  let bottomClass = 'open';
  if (m.calendarClosed || (m.isLocked && !pred)) {
    bottom = m.calendarClosed ? 'saison fermée' : 'verrouillé';
    bottomClass = 'locked-closed';
  } else if (m.isLocked && pred?.points != null) {
    const labels = { exact: '🎯 +3 pts — score exact !', diff: '👏 +2 pts — bon écart', winner: '💪 +1 pt — bon vainqueur', miss: '😅 raté' };
    bottom = labels[pred.points_detail] ?? `${pred.points} pts`;
    bottomClass = pred.points > 0 ? 'points' : '';
  } else if (m.isLocked) {
    bottom = 'verrouillé';
    bottomClass = '';
  }

  return `<div class="match-card" data-match="${m.id}">
    <div class="match-top">
      <div class="team">${teamCrest(m.home_team_name, m.comp_code, homeTeamId)}${m.home_team_name}</div>
      <div class="score-mid">
        <div class="score-pill ${filled ? 'filled' : ''}" style="${filled ? `color:${cc.color};border-color:${cc.color};background:${cc.bg}` : ''}">
          ${m.isLocked ? (h !== '' ? h : '–') : `<input type="number" min="0" max="20" data-side="home" data-match="${m.id}" value="${h}" placeholder="–">`}
        </div>
        <div class="score-pill ${filled ? 'filled' : ''}" style="${filled ? `color:${cc.color};border-color:${cc.color};background:${cc.bg}` : ''}">
          ${m.isLocked ? (a !== '' ? a : '–') : `<input type="number" min="0" max="20" data-side="away" data-match="${m.id}" value="${a}" placeholder="–">`}
        </div>
      </div>
      <div class="team right">${m.away_team_name}${teamCrest(m.away_team_name, m.comp_code, awayTeamId)}</div>
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
    showToast('Pronostic enregistré ✓', 'success');
    renderApp();
  } catch (err) {
    showToast(err.message, 'error');
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
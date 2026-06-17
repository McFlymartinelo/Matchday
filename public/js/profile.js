import { auth, groups, standings, showToast } from './api.js';

import { computeBadges, formatRankingExport } from './badges.js';

import {

  AVATAR_GROUPS,

  formatClubAvatar,

  isClubAvatar,

  renderAvatarHtml,

  renderClubCrestHtml,

} from './avatars.js';



export { AVATAR_GROUPS };



export const PROFILE_COLORS = [

  '#6B3FD6', '#2D8B57', '#E0532E', '#1C6FD0', '#C9701F',

  '#E91E63', '#009688', '#FF9800', '#795548', '#607D8B',

];



function renderEmojiGrid(emojis, currentAvatar) {

  return emojis.map(e => `

    <button type="button" class="avatar-choice ${currentAvatar === e ? 'active' : ''}" data-avatar="${e}" data-kind="emoji">${e}</button>

  `).join('');

}



function renderClubGrid(teams, currentAvatar, filterCompId = null) {

  const list = filterCompId ? teams.filter(t => t.competition_id === filterCompId) : teams;

  if (!list.length) {

    return '<div class="avatar-clubs-empty">Aucun club pour ce championnat</div>';

  }

  return list.map(team => {

    const value = formatClubAvatar(team);

    const crest = renderClubCrestHtml(

      {
        teamId: team.team_id,
        logoUrl: team.logo_url,
        compCode: team.comp_code,
        label: team.short_name,
        teamName: team.team_name,
      },

      { title: team.team_name }

    );

    return `<button type="button" class="avatar-club-choice ${currentAvatar === value ? 'active' : ''}"

      data-avatar="${value}" data-kind="club" title="${team.team_name}">

      ${crest}

      <span class="avatar-club-name">${team.short_name || team.team_name}</span>

      <span class="avatar-club-comp">${team.comp_nom}</span>

    </button>`;

  }).join('');

}



function detectInitialTab(currentAvatar) {

  if (isClubAvatar(currentAvatar)) return 'clubs';

  for (const group of AVATAR_GROUPS) {

    if (group.emojis?.includes(currentAvatar)) return group.id;

  }

  return 'football';

}



export async function renderProfile(el, state, renderApp) {

  el.innerHTML = '<div class="empty-state">Chargement…</div>';



  let bilan = {

    rank: 1, memberCount: 1, totalPoints: 0, xiPoints: 0, avgPerMatch: '0.00',

    exactCount: 0, diffCount: 0, winnerCount: 0, missCount: 0,

    scoredCount: 0, finishedMatches: 0, precision: 0,

  };

  let ranking = [];

  let clubTeams = [];



  try {

    [bilan, ranking, clubTeams] = await Promise.all([

      standings.profile(state.group.id),

      standings.general(state.group.id),

      groups.clubs(state.group.id).catch(() => []),

    ]);

  } catch (err) {

    console.error('Profil:', err);

    showToast('Bilan indisponible — affichage partiel');

    try { ranking = await standings.general(state.group.id); } catch { /* ignore */ }

    try { clubTeams = await groups.clubs(state.group.id); } catch { /* ignore */ }

  }



  const badges = computeBadges({ ...bilan, rank: bilan.rank, memberCount: bilan.memberCount, xiPoints: bilan.xiPoints });

  const color = state.user.profileColor || '#6B3FD6';

  const barWidth = bilan.scoredCount > 0

    ? Math.round(((bilan.exactCount + bilan.diffCount + bilan.winnerCount) / bilan.scoredCount) * 100)

    : 0;



  let selectedAvatar = state.user.avatar || '⚽';

  let selectedColor = state.user.profileColor || '#6B3FD6';

  let activeAvatarTab = detectInitialTab(selectedAvatar);

  let clubCompFilter = null;



  el.innerHTML = `

    <div class="section-card profile-hero">

      <div class="profile-hero-row">

        <div class="profile-avatar-lg ${isClubAvatar(selectedAvatar) ? 'profile-avatar-club' : ''}" id="profile-avatar-preview" style="background:${color}">

          ${renderAvatarHtml(selectedAvatar, state.user.displayName, color)}

        </div>

        <div class="profile-hero-info">

          <div class="profile-name-edit" id="profile-name-display" title="Clique pour modifier">${state.user.displayName}</div>

          <input class="profile-name-input hidden" id="profile-name-input" value="${state.user.displayName}">

          <div class="profile-hint">Clique sur ton pseudo pour le modifier</div>

          <div class="profile-role-pill">joueur</div>

        </div>

      </div>

    </div>



    <div class="section-card">

      <div class="section-head"><div class="jn">Mon bilan</div></div>

      <div class="bilan-grid">

        <div class="bilan-stat">

          <div class="bilan-value">#${bilan.rank} <span class="bilan-sub">/ ${bilan.memberCount}</span></div>

          <div class="bilan-label">Classement</div>

        </div>

        <div class="bilan-stat highlight">

          <div class="bilan-value">${bilan.totalPoints}</div>

          <div class="bilan-label">Points${bilan.xiPoints ? ` <span class="bilan-xi">(+${bilan.xiPoints} 11)</span>` : ''}</div>

        </div>

        <div class="bilan-stat">

          <div class="bilan-value">${bilan.avgPerMatch}</div>

          <div class="bilan-label">Moy./match</div>

        </div>

      </div>

      <div class="bilan-breakdown">

        <div class="breakdown-item exact"><span class="breakdown-n">${bilan.exactCount}</span><span class="breakdown-l">Exact</span></div>

        <div class="breakdown-item diff"><span class="breakdown-n">${bilan.diffCount}</span><span class="breakdown-l">Écart</span></div>

        <div class="breakdown-item winner"><span class="breakdown-n">${bilan.winnerCount}</span><span class="breakdown-l">1N2</span></div>

        <div class="breakdown-item miss"><span class="breakdown-n">${bilan.missCount}</span><span class="breakdown-l">Raté</span></div>

      </div>

      <div class="precision-bar-wrap">

        <div class="precision-bar" style="width:${barWidth}%"></div>

      </div>

      <div class="precision-text">

        Précision ${bilan.precision}% · ${bilan.scoredCount} pronos notés sur ${bilan.finishedMatches} matchs terminés

      </div>

    </div>



    ${badges.length ? `

    <div class="section-card">

      <div class="section-head"><div class="jn">Badges</div></div>

      <div class="badges-row">

        ${badges.map(b => `<div class="badge-pill">${b.emoji} ${b.label}</div>`).join('')}

      </div>

    </div>` : ''}



    <div class="section-card">

      <div class="section-head"><div class="jn">Partager le classement</div></div>

      <p class="profile-desc">Copie un résumé texte du classement du groupe actuel.</p>

      <button class="btn btn-primary" id="copy-ranking">📋 Copier le classement</button>

    </div>



    <div class="section-card">

      <div class="section-head"><div class="jn">Choisis ton avatar</div></div>

      <div class="avatar-tabs" id="avatar-tabs">

        ${AVATAR_GROUPS.map(g => `

          <button type="button" class="avatar-tab ${activeAvatarTab === g.id ? 'active' : ''}" data-tab="${g.id}">

            ${g.icon} ${g.label}

          </button>

        `).join('')}

      </div>

      <div id="avatar-panel"></div>

    </div>



    <div class="section-card">

      <div class="section-head"><div class="jn">Choisis ta couleur</div></div>

      <div class="color-picker" id="color-picker">

        ${PROFILE_COLORS.map(c => `

          <div class="color-swatch ${c === state.user.profileColor ? 'active' : ''}" data-color="${c}" style="background:${c}"></div>

        `).join('')}

      </div>

      <div class="custom-color-row">

        <label class="custom-color-label">Couleur personnalisée</label>

        <input type="color" id="custom-color" value="${state.user.profileColor || '#6B3FD6'}">

      </div>

    </div>

  `;



  const nameDisplay = document.getElementById('profile-name-display');

  const nameInput = document.getElementById('profile-name-input');

  const avatarPreview = document.getElementById('profile-avatar-preview');

  const avatarPanel = document.getElementById('avatar-panel');



  function paintAvatarPanel() {

    const group = AVATAR_GROUPS.find(g => g.id === activeAvatarTab) ?? AVATAR_GROUPS[0];



    if (group.type === 'clubs') {

      const compFilters = state.competitions.length > 1 ? `

        <div class="avatar-club-filters">

          <button type="button" class="avatar-club-filter ${!clubCompFilter ? 'active' : ''}" data-comp="">Tous</button>

          ${state.competitions.map(c => `

            <button type="button" class="avatar-club-filter ${clubCompFilter === c.id ? 'active' : ''}" data-comp="${c.id}"

              style="${clubCompFilter === c.id ? `background:${c.couleur};color:white;border-color:${c.couleur}` : ''}">

              ${c.emoji ?? ''} ${c.nom}

            </button>

          `).join('')}

        </div>

        <input type="search" class="avatar-club-search" id="avatar-club-search" placeholder="Filtrer un club…">

      ` : `<input type="search" class="avatar-club-search" id="avatar-club-search" placeholder="Filtrer un club…">`;



      avatarPanel.innerHTML = `

        <p class="profile-desc">Écussons des clubs de ton groupe — couleur selon le championnat.</p>

        ${compFilters}

        <div class="avatar-club-grid" id="avatar-club-grid">

          ${renderClubGrid(clubTeams, selectedAvatar, clubCompFilter)}

        </div>

      `;



      avatarPanel.querySelectorAll('.avatar-club-filter').forEach(btn => {

        btn.onclick = () => {

          clubCompFilter = btn.dataset.comp ? Number(btn.dataset.comp) : null;

          paintAvatarPanel();

          bindAvatarChoices();

        };

      });



      const searchInput = document.getElementById('avatar-club-search');

      searchInput?.addEventListener('input', () => {

        const q = searchInput.value.trim().toLowerCase();

        document.querySelectorAll('#avatar-club-grid .avatar-club-choice').forEach(btn => {

          const name = btn.title.toLowerCase();

          const short = btn.querySelector('.avatar-club-name')?.textContent.toLowerCase() ?? '';

          btn.classList.toggle('hidden', q.length > 0 && !name.includes(q) && !short.includes(q));

        });

      });

    } else {

      avatarPanel.innerHTML = `

        <div class="avatar-grid" id="avatar-emoji-grid">

          ${renderEmojiGrid(group.emojis, selectedAvatar)}

        </div>

      `;

    }

  }



  async function selectAvatar(value) {

    selectedAvatar = value;

    document.querySelectorAll('.avatar-choice, .avatar-club-choice').forEach(b => {

      b.classList.toggle('active', b.dataset.avatar === value);

    });

    avatarPreview.classList.toggle('profile-avatar-club', isClubAvatar(value));

    avatarPreview.innerHTML = renderAvatarHtml(value, state.user.displayName, selectedColor);

    await auth.updateProfile({ avatar: value });

    state.user = await auth.me();

    showToast('Avatar mis à jour ✓');

    renderApp();

  }



  function bindAvatarChoices() {

    avatarPanel.querySelectorAll('[data-avatar]').forEach(btn => {

      btn.onclick = () => selectAvatar(btn.dataset.avatar);

    });

  }



  paintAvatarPanel();

  bindAvatarChoices();



  document.querySelectorAll('#avatar-tabs .avatar-tab').forEach(tab => {

    tab.onclick = () => {

      activeAvatarTab = tab.dataset.tab;

      document.querySelectorAll('#avatar-tabs .avatar-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeAvatarTab));

      paintAvatarPanel();

      bindAvatarChoices();

    };

  });



  nameDisplay.onclick = () => {

    nameDisplay.classList.add('hidden');

    nameInput.classList.remove('hidden');

    nameInput.focus();

    nameInput.select();

  };



  const saveName = async () => {

    const val = nameInput.value.trim();

    if (val && val !== state.user.displayName) {

      await auth.updateProfile({ displayName: val });

      state.user = await auth.me();

      showToast('Pseudo mis à jour ✓');

    }

    nameInput.classList.add('hidden');

    nameDisplay.classList.remove('hidden');

    nameDisplay.textContent = state.user.displayName;

  };



  nameInput.onblur = saveName;

  nameInput.onkeydown = (e) => {

    if (e.key === 'Enter') nameInput.blur();

    if (e.key === 'Escape') { nameInput.value = state.user.displayName; nameInput.blur(); }

  };



  document.querySelectorAll('#color-picker .color-swatch').forEach(s => {

    s.onclick = async () => {

      selectedColor = s.dataset.color;

      document.querySelectorAll('#color-picker .color-swatch').forEach(x => x.classList.remove('active'));

      s.classList.add('active');

      document.getElementById('custom-color').value = selectedColor;

      if (!isClubAvatar(selectedAvatar)) avatarPreview.style.background = selectedColor;

      await auth.updateProfile({ profileColor: selectedColor });

      state.user = await auth.me();

      showToast('Couleur mise à jour ✓');

      renderApp();

    };

  });



  document.getElementById('custom-color').onchange = async (e) => {

    selectedColor = e.target.value;

    document.querySelectorAll('#color-picker .color-swatch').forEach(x => x.classList.remove('active'));

    if (!isClubAvatar(selectedAvatar)) avatarPreview.style.background = selectedColor;

    await auth.updateProfile({ profileColor: selectedColor });

    state.user = await auth.me();

    showToast('Couleur mise à jour ✓');

    renderApp();

  };



  document.getElementById('copy-ranking').onclick = async () => {

    const text = formatRankingExport(state.group.name, ranking);

    try {

      await navigator.clipboard.writeText(text);

      showToast('Classement copié ! 📋');

    } catch {

      showToast('Impossible de copier');

    }

  };

}



import { seasonXi, showToast, compColors } from './api.js';

const FORMATIONS = {
  '433': {
    label: '4-3-3',
    slots: [
      { id: 'gk', role: 'GK', x: 50, y: 90 },
      { id: 'lb', role: 'DEF', x: 14, y: 74 },
      { id: 'cb1', role: 'DEF', x: 36, y: 78 },
      { id: 'cb2', role: 'DEF', x: 64, y: 78 },
      { id: 'rb', role: 'DEF', x: 86, y: 74 },
      { id: 'cm1', role: 'MID', x: 28, y: 48 },
      { id: 'cm2', role: 'MID', x: 50, y: 44 },
      { id: 'cm3', role: 'MID', x: 72, y: 48 },
      { id: 'lw', role: 'FWD', x: 20, y: 16 },
      { id: 'st', role: 'FWD', x: 50, y: 10 },
      { id: 'rw', role: 'FWD', x: 80, y: 16 },
    ],
  },
  '442': {
    label: '4-4-2',
    slots: [
      { id: 'gk', role: 'GK', x: 50, y: 90 },
      { id: 'lb', role: 'DEF', x: 14, y: 74 },
      { id: 'cb1', role: 'DEF', x: 36, y: 78 },
      { id: 'cb2', role: 'DEF', x: 64, y: 78 },
      { id: 'rb', role: 'DEF', x: 86, y: 74 },
      { id: 'lm', role: 'MID', x: 14, y: 46 },
      { id: 'cm1', role: 'MID', x: 36, y: 50 },
      { id: 'cm2', role: 'MID', x: 64, y: 50 },
      { id: 'rm', role: 'MID', x: 86, y: 46 },
      { id: 'st1', role: 'FWD', x: 36, y: 14 },
      { id: 'st2', role: 'FWD', x: 64, y: 14 },
    ],
  },
  '352': {
    label: '3-5-2',
    slots: [
      { id: 'gk', role: 'GK', x: 50, y: 90 },
      { id: 'cb1', role: 'DEF', x: 28, y: 76 },
      { id: 'cb2', role: 'DEF', x: 50, y: 80 },
      { id: 'cb3', role: 'DEF', x: 72, y: 76 },
      { id: 'lwb', role: 'MID', x: 10, y: 52 },
      { id: 'cm1', role: 'MID', x: 30, y: 48 },
      { id: 'cm2', role: 'MID', x: 50, y: 44 },
      { id: 'cm3', role: 'MID', x: 70, y: 48 },
      { id: 'rwb', role: 'MID', x: 90, y: 52 },
      { id: 'st1', role: 'FWD', x: 38, y: 14 },
      { id: 'st2', role: 'FWD', x: 62, y: 14 },
    ],
  },
};

const POS_LABELS = { GK: 'Gardien', DEF: 'Défenseur', MID: 'Milieu', FWD: 'Attaquant' };
const POS_SHORT = { GK: 'GK', DEF: 'DEF', MID: 'MIL', FWD: 'ATT' };

const XI_INTRO = `Compose ton équipe idéale pour toute la saison. À chaque journée, si tes joueurs figurent dans le <strong>11 type</strong> de leur championnat, tu gagnes <strong>+1 pt par joueur</strong>. Choisis ta tactique, clique sur un poste, puis sélectionne un joueur (max <strong>1 par club</strong>). Tu peux placer un joueur hors de son poste habituel — un repère <strong>⚠️</strong> l'indiquera.`;

function isOutOfPosition(player, slotRole) {
  const natural = player.natural_position;
  if (natural == null || natural === '') return false;
  return natural !== slotRole;
}

function slotForPlayer(draft, slotId, formationKey) {
  return getFormation(formationKey).slots.find(s => s.id === slotId);
}

function posLabel(role) {
  return POS_LABELS[role] ?? role;
}

function getFormation(key) {
  return FORMATIONS[key] ?? FORMATIONS['433'];
}

function draftToList(draft) {
  return Object.entries(draft).map(([slotId, p]) => ({ ...p, slot_id: slotId }));
}

function assignLegacyPlayers(players, formationKey) {
  const draft = {};
  const slots = getFormation(formationKey).slots;
  const byRole = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of players) {
    const role = p.position ?? 'MID';
    (byRole[role] ?? byRole.MID).push(p);
  }
  for (const slot of slots) {
    const list = byRole[slot.role] ?? [];
    if (list.length) {
      const p = list.shift();
      draft[slot.id] = {
        ...p,
        slot_id: slot.id,
        position: slot.role,
        natural_position: p.natural_position ?? p.position ?? slot.role,
      };
    }
  }
  return draft;
}

function remapDraftToFormation(draft, newFormationKey) {
  const players = draftToList(draft);
  return assignLegacyPlayers(players, newFormationKey);
}

function canAddPlayer(draft, player, slotId, formationKey) {
  const slot = getFormation(formationKey).slots.find(s => s.id === slotId);
  if (!slot) return { ok: false, reason: 'Poste invalide' };
  if (draft[slotId]) return { ok: false, reason: 'Poste déjà occupé' };
  if (Object.values(draft).some(p => p.player_id === player.player_id)) {
    return { ok: false, reason: 'Joueur déjà dans ton 11' };
  }
  if (Object.values(draft).some(p => p.team_id === player.team_id)) {
    const club = Object.values(draft).find(p => p.team_id === player.team_id)?.team_name ?? 'ce club';
    return { ok: false, reason: `Déjà 1 joueur de ${club}` };
  }
  const wrongPost = (player.position ?? 'MID') !== slot.role;
  return { ok: true, wrongPost };
}

function renderPitch(draft, formationKey, editable, activeSlot) {
  const formation = getFormation(formationKey);
  return formation.slots.map(slot => {
    const p = draft[slot.id];
    const isActive = activeSlot === slot.id;
    if (p) {
      const comp = p.comp_code ?? 'L1';
      const cc = compColors(comp);
      const oop = isOutOfPosition(p, slot.role);
      return `<button type="button" class="player-slot ${editable ? 'removable' : ''} ${oop ? 'out-of-position' : ''}"
        data-remove="${p.player_id}" data-slot="${slot.id}"
        style="left:${slot.x}%;top:${slot.y}%;border:2px solid ${oop ? '#C9701F' : cc.color};background:${cc.bg}"
        title="${editable ? (oop ? `Hors poste (${posLabel(p.natural_position)} en ${posLabel(slot.role)}) — Retirer` : 'Retirer') : ''}">
        ${oop ? '<span class="player-slot-warn">⚠️</span>' : ''}
        <div class="player-slot-role">${POS_SHORT[slot.role]}</div>
        <div class="player-slot-name">${(p.player_name || '').split(' ').pop()}</div>
        <div class="pos">${p.team_name}</div>
      </button>`;
    }
    if (!editable) return '';
    return `<button type="button" class="pitch-slot empty ${isActive ? 'active' : ''}" data-slot="${slot.id}"
      style="left:${slot.x}%;top:${slot.y}%;" title="Ajouter un ${posLabel(slot.role)}">
      <span class="pitch-slot-plus">+</span>
      <span class="pitch-slot-label">${posLabel(slot.role)}</span>
    </button>`;
  }).join('');
}

function renderDraftList(draft, formationKey, editable) {
  const list = draftToList(draft);
  if (!list.length) {
    return `<div class="xi-draft-empty">Clique sur un poste du terrain pour ajouter un joueur</div>`;
  }
  const slotOrder = getFormation(formationKey).slots.map(s => s.id);
  list.sort((a, b) => slotOrder.indexOf(a.slot_id) - slotOrder.indexOf(b.slot_id));
  return list.map(p => {
    const cc = compColors(p.comp_code ?? 'L1');
    const slot = slotForPlayer(draft, p.slot_id, formationKey);
    const oop = slot && isOutOfPosition(p, slot.role);
    return `<div class="xi-draft-row ${oop ? 'out-of-position' : ''}">
      <span class="xi-draft-pos" style="background:${cc.bg};color:${cc.color}">${POS_SHORT[p.position] ?? p.position}</span>
      <span class="xi-draft-info">
        <strong>${p.player_name}</strong>
        <span>${p.team_name} · ${p.comp_nom ?? ''}${oop ? ` · ⚠️ ${posLabel(p.natural_position)}` : ''}</span>
      </span>
      ${editable ? `<button type="button" class="xi-remove" data-remove="${p.player_id}" aria-label="Retirer">✕</button>` : ''}
    </div>`;
  }).join('');
}

function renderSearchResults(results, draft, activeSlot, formationKey) {
  if (!activeSlot) {
    return `<div class="xi-search-empty">👆 Choisis d'abord un poste sur le terrain (ex. Gardien)</div>`;
  }
  const slot = getFormation(formationKey).slots.find(s => s.id === activeSlot);
  if (!results.length) {
    return `<div class="xi-search-empty">Aucun joueur trouvé</div>`;
  }
  const sorted = [...results].sort((a, b) => {
    const aMatch = (a.position ?? 'MID') === slot?.role ? 0 : 1;
    const bMatch = (b.position ?? 'MID') === slot?.role ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return (a.player_name ?? '').localeCompare(b.player_name ?? '', 'fr');
  });
  return sorted.map(p => {
    const check = canAddPlayer(draft, p, activeSlot, formationKey);
    const cc = compColors(p.comp_code ?? 'L1');
    const inXi = Object.values(draft).some(x => x.player_id === p.player_id);
    const wrongRole = slot && (p.position ?? 'MID') !== slot.role;
    const disabled = !check.ok;
    return `<button type="button" class="xi-player-option ${inXi ? 'in-xi' : ''} ${wrongRole && !inXi ? 'wrong-pos' : ''} ${disabled && !inXi ? 'disabled' : ''}"
      data-player='${JSON.stringify(p).replace(/'/g, '&#39;')}' ${disabled && !inXi ? 'disabled' : ''}>
      <span class="xi-opt-pos" style="background:${cc.bg};color:${cc.color}">${POS_SHORT[p.position] ?? p.position}</span>
      <span class="xi-opt-info">
        <strong>${p.player_name}</strong>
        <span>${p.team_name}${p.comp_nom ? ` · ${p.comp_nom}` : ''}</span>
      </span>
      ${inXi ? '<span class="xi-opt-badge">✓</span>' : wrongRole ? '<span class="xi-opt-warn">Hors poste</span>' : !check.ok ? `<span class="xi-opt-warn">${check.reason.includes('club') ? '⚠️ club' : '—'}</span>` : '<span class="xi-opt-add">+</span>'}
    </button>`;
  }).join('');
}

export async function renderSeasonXi(el, state) {
  el.innerHTML = '<div class="empty-state">Chargement…</div>';

  let data;
  try {
    data = await seasonXi.get(state.group.id);
  } catch (err) {
    el.innerHTML = `<div class="section-card"><div class="empty-state">${err.message}</div></div>`;
    return;
  }

  let formation = data.formation ?? '433';
  if (!FORMATIONS[formation]) formation = '433';

  let draft = {};
  const loaded = (data.players ?? []).map(p => ({
    player_id: p.player_id,
    player_name: p.player_name,
    team_id: p.team_id,
    team_name: p.team_name,
    competition_id: p.competition_id,
    position: p.position,
    slot_id: p.slot_id,
    natural_position: p.natural_position ?? p.position,
    comp_code: p.comp_code,
    comp_nom: p.comp_nom,
  }));

  if (loaded.some(p => p.slot_id)) {
    for (const p of loaded) {
      if (p.slot_id) draft[p.slot_id] = p;
    }
  } else if (loaded.length) {
    draft = assignLegacyPlayers(loaded, formation);
  }

  let activeSlot = null;
  const editable = !data.isLocked;
  const groupComps = state.competitions ?? [];

  function paint() {
    const count = Object.keys(draft).length;
    const gkCount = Object.values(draft).filter(p => p.position === 'GK').length;
    const countLabel = `${count}/11 joueurs${count === 11 && gkCount === 0 ? ' · gardien requis' : ''}`;
    const activeSlotLabel = activeSlot
      ? getFormation(formation).slots.find(s => s.id === activeSlot)
      : null;

    el.innerHTML = `
      <div class="section-card">
        <div class="section-head">
          <div class="jn">Mon 11 de saison</div>
          <div class="countdown-bubble">${data.isLocked ? '🔒 Verrouillé' : '✏️ Modifiable'}</div>
        </div>
        <p class="xi-intro">${XI_INTRO}</p>
        ${editable ? `
        <div class="xi-formation-tabs">
          ${Object.entries(FORMATIONS).map(([key, f]) =>
            `<button type="button" class="xi-formation-tab ${formation === key ? 'active' : ''}" data-formation="${key}">${f.label}</button>`
          ).join('')}
        </div>` : `<div class="xi-formation-label">Tactique : ${getFormation(formation).label}</div>`}
        <div class="xi-count">${countLabel}</div>
        <div class="pitch"><div class="pitch-line pitch-line-marked">
          ${renderPitch(draft, formation, editable, activeSlot)}
        </div></div>
        ${activeSlotLabel && editable ? `<div class="xi-active-slot">Poste sélectionné : <strong>${posLabel(activeSlotLabel.role)}</strong></div>` : ''}
        <div class="xi-bonus">Bonus total : +${data.bonusTotal ?? 0} pts</div>
      </div>

      <div class="section-card">
        <div class="section-head"><div class="jn">Ma sélection</div></div>
        <div id="xi-draft-list">${renderDraftList(draft, formation, editable)}</div>
      </div>

      ${editable ? `
      <div class="section-card xi-picker-section" id="xi-picker-section">
        <div class="section-head">
          <div class="jn">${activeSlotLabel ? `Choisir un ${posLabel(activeSlotLabel.role)}` : 'Ajouter un joueur'}</div>
        </div>
        <p class="profile-desc">${activeSlotLabel
          ? `Recherche ci-dessous — les joueurs <strong>hors poste</strong> sont autorisés (repère ⚠️).`
          : 'Clique sur un poste vide du terrain pour ouvrir la liste des joueurs.'}</p>
        <input id="xi-search" class="xi-search-input" placeholder="${activeSlotLabel ? `Rechercher un joueur…` : 'Sélectionne d\'abord un poste sur le terrain'}" ${!activeSlot ? 'disabled' : ''}>
        <div id="xi-results" class="xi-results">${renderSearchResults([], draft, activeSlot, formation)}</div>
      </div>` : ''}
    `;

    if (editable) bindEvents();
  }

  async function loadBrowse(q = '') {
    const resultsEl = document.getElementById('xi-results');
    if (!resultsEl) return;
    if (!activeSlot) {
      resultsEl.innerHTML = renderSearchResults([], draft, activeSlot, formation);
      return;
    }
    try {
      const results = q.length >= 2
        ? await seasonXi.search(state.group.id, q)
        : await seasonXi.browse(state.group.id);
      resultsEl.innerHTML = renderSearchResults(results, draft, activeSlot, formation);
      resultsEl.querySelectorAll('.xi-player-option:not(.disabled):not(.in-xi)').forEach(btn => {
        btn.onclick = () => addPlayer(JSON.parse(btn.dataset.player));
      });
    } catch (err) {
      resultsEl.innerHTML = `<div class="xi-search-empty">${err.message}</div>`;
    }
  }

  async function saveDraft() {
    if (!editable) return;
    try {
      await seasonXi.save(state.group.id, draftToList(draft).map(p => ({
        player_id: p.player_id,
        player_name: p.player_name,
        team_id: p.team_id,
        team_name: p.team_name,
        competition_id: p.competition_id,
        position: p.position,
        slot_id: p.slot_id,
        natural_position: p.natural_position,
      })), formation);
      showToast('11 enregistré ✓');
    } catch (err) {
      showToast(err.message);
    }
  }

  function addPlayer(player) {
    if (!activeSlot) {
      showToast('Choisis d\'abord un poste sur le terrain');
      return;
    }
    const check = canAddPlayer(draft, player, activeSlot, formation);
    if (!check.ok) { showToast(check.reason); return; }
    const slot = getFormation(formation).slots.find(s => s.id === activeSlot);
    const natural = player.position ?? 'MID';
    draft[activeSlot] = {
      ...player,
      position: slot.role,
      natural_position: natural,
      slot_id: activeSlot,
      comp_code: player.comp_code,
      comp_nom: player.comp_nom,
    };
    activeSlot = null;
    paint();
    loadBrowse(document.getElementById('xi-search')?.value ?? '');
    saveDraft();
    if (natural !== slot.role) {
      showToast(`${player.player_name} placé hors poste (${posLabel(natural)} → ${posLabel(slot.role)})`);
    }
  }

  function removePlayer(playerId) {
    for (const [slotId, p] of Object.entries(draft)) {
      if (p.player_id === playerId) {
        delete draft[slotId];
        break;
      }
    }
    paint();
    loadBrowse(document.getElementById('xi-search')?.value ?? '');
    saveDraft();
  }

  function scrollToPlayerPicker() {
    requestAnimationFrame(() => {
      const section = document.getElementById('xi-picker-section');
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        const search = document.getElementById('xi-search');
        search?.focus({ preventScroll: true });
      }, 400);
    });
  }

  function bindEvents() {
    document.querySelectorAll('.pitch-slot.empty').forEach(btn => {
      btn.onclick = () => {
        activeSlot = btn.dataset.slot;
        paint();
        loadBrowse(document.getElementById('xi-search')?.value ?? '');
        scrollToPlayerPicker();
      };
    });

    document.querySelectorAll('.player-slot[data-remove]').forEach(btn => {
      btn.onclick = () => removePlayer(Number(btn.dataset.remove));
    });

    document.querySelectorAll('[data-formation]').forEach(btn => {
      btn.onclick = () => {
        const next = btn.dataset.formation;
        if (next === formation) return;
        draft = remapDraftToFormation(draft, next);
        formation = next;
        activeSlot = null;
        paint();
        saveDraft();
      };
    });

    let debounce;
    document.getElementById('xi-search')?.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => loadBrowse(e.target.value.trim()), 300);
    });

    loadBrowse();
  }

  paint();
}

import { seasonXi, showToast, compColors } from './api.js';

const POSITIONS = {
  GK: [{ x: 50, y: 88 }],
  DEF: [{ x: 12, y: 68 }, { x: 32, y: 68 }, { x: 68, y: 68 }, { x: 88, y: 68 }],
  MID: [{ x: 22, y: 42 }, { x: 50, y: 42 }, { x: 78, y: 42 }],
  FWD: [{ x: 22, y: 15 }, { x: 50, y: 15 }, { x: 78, y: 15 }],
};

const POS_LABELS = { GK: 'Gardien', DEF: 'Défenseur', MID: 'Milieu', FWD: 'Attaquant' };

function posLabel(pos) {
  return POS_LABELS[pos] ?? pos;
}

function canAddPlayer(draft, player) {
  if (draft.length >= 11) return { ok: false, reason: 'Maximum 11 joueurs' };
  if (draft.some(p => p.player_id === player.player_id)) return { ok: false, reason: 'Joueur déjà dans ton 11' };
  if (draft.some(p => p.team_id === player.team_id)) {
    const club = draft.find(p => p.team_id === player.team_id)?.team_name ?? 'ce club';
    return { ok: false, reason: `⚠️ Déjà 1 joueur de ${club}` };
  }
  return { ok: true };
}

function renderPitch(players, editable) {
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of players) {
    const pos = p.position ?? 'MID';
    (byPos[pos] ?? byPos.MID).push(p);
  }

  let html = '';
  for (const [pos, slots] of Object.entries(POSITIONS)) {
    const list = byPos[pos] ?? [];
    slots.forEach((slot, i) => {
      const p = list[i];
      if (!p) return;
      const comp = p.comp_code ?? 'L1';
      const cc = compColors(comp);
      html += `<button type="button" class="player-slot ${editable ? 'removable' : ''}" data-remove="${p.player_id}"
        style="left:${slot.x}%;top:${slot.y}%;border:2px solid ${cc.color};background:${cc.bg ?? cc.color}22"
        title="${editable ? 'Retirer' : ''}">
        <div class="player-slot-name">${(p.player_name || '').split(' ').pop()}</div>
        <div class="pos">${p.team_name}</div>
      </button>`;
    });
  }
  return html;
}

function renderDraftList(draft, editable) {
  if (!draft.length) {
    return `<div class="xi-draft-empty">Aucun joueur sélectionné — cherche ci-dessous</div>`;
  }
  return draft.map(p => {
    const cc = compColors(p.comp_code ?? 'L1');
    const teamTaken = draft.filter(x => x.team_id === p.team_id).length > 1;
    return `<div class="xi-draft-row ${teamTaken ? 'error' : ''}">
      <span class="xi-draft-pos" style="background:${cc.bg};color:${cc.color}">${p.position}</span>
      <span class="xi-draft-info">
        <strong>${p.player_name}</strong>
        <span>${p.team_name} · ${p.comp_nom ?? ''}</span>
      </span>
      ${editable ? `<button type="button" class="xi-remove" data-remove="${p.player_id}" aria-label="Retirer">✕</button>` : ''}
    </div>`;
  }).join('');
}

function renderSearchResults(results, draft) {
  if (!results.length) {
    return `<div class="xi-search-empty">Aucun joueur trouvé dans tes championnats</div>`;
  }
  return results.map(p => {
    const check = canAddPlayer(draft, p);
    const cc = compColors(p.comp_code ?? 'L1');
    const inXi = draft.some(x => x.player_id === p.player_id);
    const clubBlocked = !check.ok && check.reason.includes('Déjà 1 joueur');
    return `<button type="button" class="xi-player-option ${inXi ? 'in-xi' : ''} ${!check.ok && !inXi ? 'disabled' : ''}"
      data-player='${JSON.stringify(p).replace(/'/g, '&#39;')}' ${!check.ok && !inXi ? 'disabled' : ''}>
      <span class="xi-opt-pos" style="background:${cc.bg};color:${cc.color}">${p.position}</span>
      <span class="xi-opt-info">
        <strong>${p.player_name}</strong>
        <span>${p.team_name}${p.comp_nom ? ` · ${p.comp_nom}` : ''}</span>
      </span>
      ${inXi ? '<span class="xi-opt-badge">✓</span>' : clubBlocked ? '<span class="xi-opt-warn">⚠️ club pris</span>' : '<span class="xi-opt-add">+</span>'}
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

  let draft = (data.players ?? []).map(p => ({
    player_id: p.player_id,
    player_name: p.player_name,
    team_id: p.team_id,
    team_name: p.team_name,
    competition_id: p.competition_id,
    position: p.position,
    comp_code: p.comp_code,
    comp_nom: p.comp_nom,
  }));

  const editable = !data.isLocked;
  const groupComps = state.competitions ?? [];
  const compChips = groupComps.map(c => {
    const cc = compColors(c.code);
    return `<span class="xi-comp-chip" style="background:${cc.bg};color:${cc.color}">${c.emoji ?? ''} ${c.nom}</span>`;
  }).join('');

  function paint() {
    const gkCount = draft.filter(p => p.position === 'GK').length;
    const countLabel = `${draft.length}/11 joueurs${gkCount === 0 && draft.length > 0 ? ' · gardien requis' : ''}`;

    el.innerHTML = `
      <div class="section-card">
        <div class="section-head">
          <div class="jn">Mon 11 de saison</div>
          <div class="countdown-bubble">${data.isLocked ? '🔒 Verrouillé' : '✏️ Modifiable'}</div>
        </div>
        ${groupComps.length ? `<div class="xi-comp-chips">${compChips}</div>` : ''}
        <div class="xi-count">${countLabel}</div>
        <div class="pitch"><div class="pitch-line">
          ${renderPitch(draft, editable)}
          ${!draft.length ? '<div class="empty-state pitch-empty">Compose ton 11 !</div>' : ''}
        </div></div>
        <div class="xi-bonus">Bonus total : +${data.bonusTotal ?? 0} pts</div>
      </div>

      <div class="section-card">
        <div class="section-head"><div class="jn">Ma sélection</div></div>
        <div id="xi-draft-list">${renderDraftList(draft, editable)}</div>
      </div>

      ${editable ? `
      <div class="section-card">
        <div class="section-head"><div class="jn">Ajouter un joueur</div></div>
        <p class="profile-desc">Compose ton 11 parmi <strong>tous les championnats du groupe</strong>. Max <strong>1 joueur par club</strong>.</p>
        <input id="xi-search" class="xi-search-input" placeholder="Rechercher un joueur (ex. Mbappé, Vinicius…)">
        <div id="xi-results" class="xi-results"><div class="xi-search-empty">Chargement des joueurs…</div></div>
        <p class="xi-browse-hint">Aperçu multi-championnats — la recherche couvre Ligue 1, Liga, etc.</p>
      </div>` : ''}
    `;

    if (editable) bindEvents();
  }

  async function loadBrowse(q = '') {
    const resultsEl = document.getElementById('xi-results');
    if (!resultsEl) return;
    try {
      const results = q.length >= 2
        ? await seasonXi.search(state.group.id, q)
        : await seasonXi.browse(state.group.id);
      resultsEl.innerHTML = renderSearchResults(results, draft);
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
      await seasonXi.save(state.group.id, draft.map(p => ({
        player_id: p.player_id,
        player_name: p.player_name,
        team_id: p.team_id,
        team_name: p.team_name,
        competition_id: p.competition_id,
        position: p.position,
      })));
      showToast('11 enregistré ✓');
    } catch (err) {
      showToast(err.message);
    }
  }

  function addPlayer(player) {
    const check = canAddPlayer(draft, player);
    if (!check.ok) { showToast(check.reason); return; }
    draft.push({ ...player, comp_code: player.comp_code, comp_nom: player.comp_nom });
    paint();
    loadBrowse(document.getElementById('xi-search')?.value ?? '');
    saveDraft();
  }

  function removePlayer(playerId) {
    draft = draft.filter(p => p.player_id !== playerId);
    paint();
    loadBrowse(document.getElementById('xi-search')?.value ?? '');
    saveDraft();
  }

  function bindEvents() {
    document.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = () => removePlayer(Number(btn.dataset.remove));
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

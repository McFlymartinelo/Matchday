import { standings, compColors, compLogoHtml, compId, sameCompId, findCompetition, loadSavedCompId, saveCompId } from './api.js';
import { renderAvatarHtml } from './avatars.js';

function rankingRowsHtml(rows, currentUserId, { compact = false, startRank = 1, showExtras = true } = {}) {
  return rows.map((r, i) => {
    const rank = startRank + i;
    const isMe = r.userId === currentUserId;
    const medal = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank;
    const pts = r.totalPoints ?? r.total ?? 0;
    const extras = showExtras ? [
      r.xiPoints ? `11 : +${r.xiPoints}` : '',
      r.specialPoints ? `Vainqueur : +${r.specialPoints}` : '',
    ].filter(Boolean).join(' · ') : '';
    return `<div class="standings-row ${isMe ? 'me' : ''} ${compact ? 'standings-row-compact' : ''}">
      <div class="standings-rank">${medal}</div>
      <div class="standings-player">
        ${renderAvatarHtml(r.avatar, r.displayName, r.profileColor, 'sm')}
        <div class="standings-player-text">
          <span class="standings-name">${r.displayName}</span>
          ${extras ? `<span class="standings-sub">${extras}</span>` : ''}
        </div>
      </div>
      <div class="standings-pts">${pts}<span>pts</span></div>
    </div>`;
  }).join('');
}

function podiumHtml(rows, currentUserId, cc) {
  const top = rows.slice(0, 3);
  if (!top.length) return '';
  const order = top.length >= 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0], null] : [null, top[0], null];

  const slot = (r, place) => {
    if (!r) {
      return `<div class="podium-col podium-col-${place} podium-empty" aria-hidden="true">
        <div class="podium-step podium-step-${place}"></div>
      </div>`;
    }
    const isMe = r.userId === currentUserId;
    const pts = r.totalPoints ?? r.total ?? 0;
    return `<div class="podium-col podium-col-${place} ${isMe ? 'me' : ''}" style="--podium-accent:${cc.color};--podium-bg:${cc.bg}">
      <div class="podium-player">
        <div class="podium-medal">${place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'}</div>
        ${renderAvatarHtml(r.avatar, r.displayName, r.profileColor, 'sm')}
        <div class="podium-name">${r.displayName.split(' ')[0]}</div>
        <div class="podium-pts">${pts}<span>pts</span></div>
      </div>
      <div class="podium-step podium-step-${place}">
        <span class="podium-step-rank">${place}</span>
      </div>
    </div>`;
  };

  return `<div class="standings-podium">${slot(order[0], 2)}${slot(order[1], 1)}${slot(order[2], 3)}</div>`;
}

function standingsBlockHtml(rows, currentUserId, cc, { emptyMessage, showExtras = true } = {}) {
  if (!rows.length) {
    return `<div class="empty-state">${emptyMessage || 'Aucun point pour l\'instant'}</div>`;
  }
  const rest = rows.slice(3);
  return `${podiumHtml(rows, currentUserId, cc)}${
    rest.length
      ? `<div class="standings-rest">${rankingRowsHtml(rest, currentUserId, { startRank: 4, showExtras })}</div>`
      : ''
  }`;
}

function standingsCompStorageKey(groupId) {
  return `matchday_standings_comp_${groupId}`;
}

function resolveStandingsComp(state, comps) {
  const saved = loadSavedCompId(standingsCompStorageKey(state.group?.id), comps);
  if (saved != null) state.standingsCompId = saved;
  if (!state.standingsCompId || !findCompetition(comps, state.standingsCompId)) {
    state.standingsCompId = compId(comps[0]?.id);
  }
  return findCompetition(comps, state.standingsCompId) ?? comps[0];
}

function compStandingsPills(comps, selectedId) {
  return `<div class="standings-comp-pills">${comps.map(c => {
    const active = sameCompId(c.id, selectedId) ? 'active' : '';
    const cc = compColors(c.code);
    const style = sameCompId(c.id, selectedId) ? `background:${cc.color};color:white;border-color:${cc.color}` : '';
    return `<button type="button" class="standings-comp-pill ${active}" data-standings-comp="${c.id}" style="${style}">
      ${compLogoHtml(c, 'comp-pill-logo')} ${c.code}
    </button>`;
  }).join('')}</div>`;
}

function avgChartHtml(members) {
  if (!members.length) return '<div class="empty-state">Pas encore de stats</div>';
  const max = Math.max(...members.map(m => m.avgPerMatch), 0.1);
  return `<div class="stats-chart">
    <div class="stats-chart-title">Moyenne de points par match</div>
    <p class="stats-chart-hint">Points de pronostic ÷ nombre de matchs terminés pronostiqués.</p>
    <div class="stats-bars">${members.map(m => {
      const h = Math.round((m.avgPerMatch / max) * 100);
      return `<div class="stats-bar-col">
        <div class="stats-bar-value">${m.avgPerMatch} pt/match</div>
        <div class="stats-bar-track"><div class="stats-bar-fill" style="height:${h}%"></div></div>
        <div class="stats-bar-label">${m.displayName.split(' ')[0]}</div>
      </div>`;
    }).join('')}</div>
  </div>`;
}

function evolutionHtml(evolution, members, currentUserId) {
  if (!evolution.length) return '<div class="empty-state">Pas encore de journée terminée</div>';
  const last = evolution[evolution.length - 1];
  const memberMap = new Map(members.map(m => [m.userId, m]));
  const rows = last.rankings.map(r => {
    const m = memberMap.get(r.userId) ?? {};
    return {
      userId: r.userId,
      displayName: r.displayName,
      avatar: m.avatar,
      profileColor: m.profileColor,
      total: r.total,
    };
  });
  return `<div class="stats-evolution">
    <div class="stats-chart-title">Classement cumulé après la dernière journée</div>
    <p class="stats-chart-hint">Position générale après <strong>${last.label}</strong> (tous championnats).</p>
    ${standingsBlockHtml(rows, currentUserId, compColors('PL'), { showExtras: false })}
  </div>`;
}

function lastMatchdayGridHtml(lastMatchdayByComp, members, currentUserId) {
  const comps = lastMatchdayByComp ?? [];
  const withRound = comps.filter(c => c.matchday != null);
  if (!withRound.length) {
    return '<div class="empty-state">Aucune journée terminée pour l\'instant</div>';
  }

  const headerCells = comps.map(c => {
    if (c.matchday == null) {
      return `<th class="md-comp-col md-comp-empty" title="${c.compNom}">
        <span class="md-label-code">${c.compCode}</span>
        <span class="md-label-md">—</span>
      </th>`;
    }
    return `<th class="md-comp-col" title="${c.compNom} · Journée ${c.matchday}">
      <span class="md-label-code">${c.compCode}</span>
      <span class="md-label-md">J${c.matchday}</span>
    </th>`;
  }).join('');

  const bodyRows = members.map(m => {
    const isMe = m.userId === currentUserId;
    const cells = comps.map(c => {
      if (c.matchday == null) return `<td class="md-cell md-cell-zero">—</td>`;
      const pts = c.points[m.userId] ?? 0;
      const cls = pts > 0 ? 'md-cell-positive' : 'md-cell-zero';
      return `<td class="md-cell ${cls}">${pts > 0 ? `+${pts}` : '0'}</td>`;
    }).join('');
    return `<tr class="md-player-row ${isMe ? 'me' : ''}">
      <th class="md-player-col">
        <span class="md-player-cell">${renderAvatarHtml(m.avatar, m.displayName, m.profileColor, 'sm')}
        <span class="md-player-name">${m.displayName}</span></span>
      </th>
      ${cells}
    </tr>`;
  }).join('');

  return `<div class="stats-matchdays">
    <div class="stats-chart-title">Dernière journée par championnat</div>
    <p class="stats-chart-hint">
      Points de <strong>pronostic</strong> marqués par chaque joueur sur la
      <strong>dernière journée terminée</strong> de chaque championnat suivi.
    </p>
    <div class="md-table-wrap">
      <table class="md-table md-table-players">
        <thead>
          <tr>
            <th class="md-player-col">Joueur</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  </div>`;
}

function playerCardsHtml(members, currentUserId) {
  return `<div class="player-cards-section">
    <div class="stats-chart-title">Fiche joueur</div>
    <p class="stats-chart-hint">Récap de la saison : types de pronos réussis et précision globale.</p>
    <div class="player-cards">${members.map(m => {
      const isMe = m.userId === currentUserId;
      return `<div class="player-card ${isMe ? 'me' : ''}">
        <div class="player-card-head">
          <div class="player-card-avatar" style="background:${m.profileColor || '#6B3FD6'}">
            ${renderAvatarHtml(m.avatar, m.displayName, m.profileColor)}
          </div>
          <div>
            <div class="player-card-name">${m.displayName}</div>
            <div class="player-card-rank">#${m.rank} · ${m.totalPoints} pts</div>
          </div>
        </div>
        <div class="player-card-stats">
          <div class="pcs exact"><span>${m.exactCount}</span>Exact</div>
          <div class="pcs diff"><span>${m.diffCount}</span>Écart</div>
          <div class="pcs winner"><span>${m.winnerCount}</span>1N2</div>
          <div class="pcs miss"><span>${m.missCount}</span>Raté</div>
        </div>
        <div class="player-card-footer">Précision ${m.precision}% · Moy. ${m.avgPerMatch} pt/match</div>
      </div>`;
    }).join('')}</div>
  </div>`;
}

async function renderByCompTab(body, state) {
  const comps = state.competitions;
  if (!comps.length) {
    body.innerHTML = '<div class="empty-state">Aucun championnat suivi</div>';
    return;
  }

  const selected = resolveStandingsComp(state, comps);
  const cc = compColors(selected.code);
  const rows = await standings.general(state.group.id, selected.id);

  body.innerHTML = `<div class="section-card standings-by-comp">
    ${compStandingsPills(comps, selected.id)}
    <div class="standings-comp-header" style="border-color:${cc.color};background:${cc.bg}">
      ${compLogoHtml(selected, 'comp-head-logo')}
      <div>
        <div class="standings-comp-title">${selected.nom}</div>
        <div class="standings-comp-sub">Classement pronos · vainqueur</div>
      </div>
    </div>
    ${standingsBlockHtml(rows, state.user.id, cc, { emptyMessage: 'Aucun point sur ce championnat' })}
  </div>`;

  body.querySelectorAll('[data-standings-comp]').forEach(btn => {
    btn.onclick = () => {
      state.standingsCompId = compId(btn.dataset.standingsComp);
      saveCompId(standingsCompStorageKey(state.group.id), state.standingsCompId);
      renderByCompTab(body, state);
    };
  });

  requestAnimationFrame(() => {
    body.querySelector('.standings-comp-pill.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
}

export async function renderStandingsScreen(el, state) {
  el.innerHTML = `<div class="tabs">
    <button class="tab ${state.standingsTab === 'general' ? 'active' : ''}" data-tab="general">Général</button>
    <button class="tab ${state.standingsTab === 'byComp' ? 'active' : ''}" data-tab="byComp">Par championnat</button>
    <button class="tab ${state.standingsTab === 'stats' ? 'active' : ''}" data-tab="stats">Stats</button>
  </div><div id="standings-body"></div>`;

  el.querySelectorAll('[data-tab]').forEach(btn => {
    btn.onclick = () => { state.standingsTab = btn.dataset.tab; renderStandingsScreen(el, state); };
  });

  const body = document.getElementById('standings-body');
  body.innerHTML = '<div class="empty-state">Chargement…</div>';

  try {
    if (state.standingsTab === 'general') {
      const rows = await standings.general(state.group.id);
      body.innerHTML = `<div class="section-card standings-card">
        <div class="section-head"><div class="jn">Classement général</div></div>
        <p class="profile-desc">Tous championnats · pronos + Mon 11 + vainqueurs</p>
        ${standingsBlockHtml(rows, state.user.id, compColors('PL'))}
      </div>`;
    } else if (state.standingsTab === 'byComp') {
      await renderByCompTab(body, state);
    } else if (state.standingsTab === 'stats') {
      const data = await standings.analytics(state.group.id);
      body.innerHTML = `
        <div class="section-card">${avgChartHtml(data.members)}</div>
        <div class="section-card">${evolutionHtml(data.matchdayEvolution, data.members, state.user.id)}</div>
        <div class="section-card">${lastMatchdayGridHtml(data.lastMatchdayByComp, data.members, state.user.id)}</div>
        <div class="section-card">${playerCardsHtml(data.members, state.user.id)}</div>
      `;
    }
  } catch (err) {
    body.innerHTML = `<div class="empty-state">${err.message || 'Erreur de chargement'}</div>`;
  }
}

export function compPillsHtml(state) {
  if (state.competitions.length <= 1) return '';
  return `<div class="comp-grid">${state.competitions.map(c => {
    const active = sameCompId(c.id, state.activeComp) ? 'active' : '';
    const style = sameCompId(c.id, state.activeComp) ? `background:${c.couleur};color:white` : '';
    return `<button class="comp-pill ${active}" data-comp="${c.id}" style="${style}">
      ${compLogoHtml(c, 'comp-pill-logo')} ${c.nom}
    </button>`;
  }).join('')}</div>`;
}

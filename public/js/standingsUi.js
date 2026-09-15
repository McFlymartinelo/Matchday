import { standings, specialBets, groups, compColors, compLogoHtml, compId, sameCompId, findCompetition, loadSavedCompId, saveCompId, escapeHtml, normTeamName } from './api.js?v=64';
import { renderAvatarHtml, clubCrestLetters } from './avatars.js';
import { mountRankingChart } from './rankingChart.js?v=65';

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
          <span class="standings-name">${escapeHtml(r.displayName)}</span>
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
        <div class="podium-name">${escapeHtml(r.displayName.split(' ')[0])}</div>
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
        <div class="stats-bar-label">${escapeHtml(m.displayName.split(' ')[0])}</div>
      </div>`;
    }).join('')}</div>
  </div>`;
}

function evoCompPillsHtml(comps, selectedId) {
  const allActive = selectedId == null;
  const allStyle = allActive ? 'style="background:var(--pl);color:white;border-color:var(--pl)"' : '';
  return `<div class="standings-comp-pills evo-comp-pills">
    <button type="button" class="standings-comp-pill ${allActive ? 'active' : ''}" data-evo-comp="" ${allStyle}>Tous</button>
    ${comps.map(c => {
      const active = sameCompId(c.id, selectedId);
      const cc = compColors(c.code);
      const style = active ? `background:${cc.color};color:white;border-color:${cc.color}` : '';
      return `<button type="button" class="standings-comp-pill ${active ? 'active' : ''}" data-evo-comp="${c.id}" style="${style}">
        ${compLogoHtml(c, 'comp-pill-logo')} ${escapeHtml(c.code)}
      </button>`;
    }).join('')}
  </div>`;
}

function evolutionCardHtml(history, comps, selectedCompId, mode) {
  const rounds = history?.rounds ?? [];
  const pills = comps.length > 1 ? evoCompPillsHtml(comps, selectedCompId) : '';
  if (!rounds.length) {
    return `<div class="stats-evolution">
      <div class="stats-chart-title">Évolution du classement</div>
      <p class="stats-chart-hint">Pronos + Mon 11 · hors paris vainqueur. Un point = une journée (tous championnats).</p>
      ${pills}
      <div class="empty-state">Pas encore de journée terminée</div>
    </div>`;
  }

  return `<div class="stats-evolution">
    <div class="stats-chart-title">Évolution du classement</div>
    <p class="stats-chart-hint">Touche une journée ou un joueur. Pronos + Mon 11, hors paris vainqueur.</p>
    ${pills}
    <div class="evo-toolbar">
      <div class="evo-toggle">
        <button type="button" class="tab ${mode === 'position' ? 'active' : ''}" data-evo-mode="position">Position</button>
        <button type="button" class="tab ${mode === 'points' ? 'active' : ''}" data-evo-mode="points">Points</button>
      </div>
    </div>
    <div class="evo-chart-host" data-evo-chart></div>
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
        <span class="md-player-name">${escapeHtml(m.displayName)}</span></span>
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
            <div class="player-card-name">${escapeHtml(m.displayName)}</div>
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

async function renderStatsTab(body, state) {
  if (!state.evoMode) state.evoMode = 'position';

  const [data, history] = await Promise.all([
    standings.analytics(state.group.id),
    standings.history(state.group.id, state.evoCompId),
  ]);
  const comps = state.competitions ?? [];

  body.innerHTML = `
    <div class="section-card">${avgChartHtml(data.members)}</div>
    <div class="section-card">${evolutionCardHtml(history, comps, state.evoCompId, state.evoMode)}</div>
    <div class="section-card">${lastMatchdayGridHtml(data.lastMatchdayByComp, data.members, state.user.id)}</div>
    <div class="section-card">${playerCardsHtml(data.members, state.user.id)}</div>
  `;

  const host = body.querySelector('[data-evo-chart]');
  if (host) {
    mountRankingChart(host, history, { mode: state.evoMode, currentUserId: state.user.id });
  }

  body.querySelectorAll('[data-evo-comp]').forEach(btn => {
    btn.onclick = () => {
      const raw = btn.dataset.evoComp;
      state.evoCompId = raw === '' ? null : compId(raw);
      renderStatsTab(body, state);
    };
  });

  body.querySelectorAll('[data-evo-mode]').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.evoMode === state.evoMode) return;
      state.evoMode = btn.dataset.evoMode;
      body.querySelectorAll('[data-evo-mode]').forEach(b => {
        b.classList.toggle('active', b.dataset.evoMode === state.evoMode);
      });
      if (host) {
        mountRankingChart(host, history, { mode: state.evoMode, currentUserId: state.user.id });
      }
    };
  });
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
        <div class="standings-comp-sub">Classement pronos · vainqueur (fin de saison)</div>
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

function compChipLabel(code) {
  const map = { L1: 'L1', PL: 'PL', PD: 'Liga', SA: 'SA', BL1: 'BL', LDC: 'LDC' };
  return map[String(code ?? '').toUpperCase()] ?? String(code ?? '');
}

function shortClubLabel(name, shortByNorm) {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  const short = shortByNorm.get(normTeamName(raw));
  return short || raw;
}

function winnersLockSvg() {
  return `<svg class="winners-lock-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2"/></svg>`;
}

function pickGroupsForComp(members, bets, competitionId, revealed, currentUserId) {
  const byUser = new Map();
  for (const b of bets) {
    if (sameCompId(b.competitionId, competitionId)) byUser.set(b.userId, b);
  }
  const groupsMap = new Map();
  for (const m of members) {
    const bet = byUser.get(m.userId);
    const canSee = revealed || m.userId === currentUserId;
    const team = canSee ? (bet?.betValue ?? '') : null;
    const key = team === null ? '__hidden' : team;
    if (!groupsMap.has(key)) groupsMap.set(key, { team, hidden: team === null, members: [], pointsByUser: new Map() });
    const g = groupsMap.get(key);
    g.members.push(m);
    if (bet?.points) g.pointsByUser.set(m.userId, bet.points);
  }
  return [...groupsMap.values()].sort((a, b) => {
    if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
    if (!a.team && b.team) return 1;
    if (a.team && !b.team) return -1;
    return b.members.length - a.members.length || String(a.team).localeCompare(String(b.team), 'fr');
  });
}

function winnersAvatar(m, size = 'sm') {
  return renderAvatarHtml(m.avatar, m.displayName, m.profileColor, size);
}

function paintWinnersTab(body, state, payload, shortByNorm) {
  const { competitions, members, bets } = payload;
  const currentUserId = state.user.id;
  const selectedId = compId(state.winnersCompId);
  const selected = findCompetition(competitions, selectedId);

  if (!competitions.length) {
    body.innerHTML = `<div class="section-card"><div class="empty-state">Aucun championnat suivi par ce groupe.</div></div>`;
    return;
  }

  const favRows = competitions.map(c => {
    const cc = compColors(c.code);
    const revealed = !!c.revealed;
    const ranked = pickGroupsForComp(members, bets, c.id, revealed, currentUserId);
    const lead = revealed ? ranked.find(g => g.team) : null;
    const pct = lead ? Math.round((lead.members.length / members.length) * 100) : 0;
    const on = sameCompId(c.id, selectedId);
    const meta = !revealed
      ? 'Pas encore révélés'
      : (lead?.team ? escapeHtml(shortClubLabel(lead.team, shortByNorm)) : 'Pas de prono');
    const n = revealed && lead ? `${lead.members.length}/${members.length}` : '—';
    return `<button type="button" class="winners-fav${on ? ' is-on' : ''}" data-winners-comp="${c.id}" aria-pressed="${on}">
      <span class="winners-fav-code" style="color:${cc.color}">${escapeHtml(compChipLabel(c.code))}</span>
      <span class="winners-fav-main">
        <span class="winners-bar-track"><span class="winners-bar" style="width:${pct}%;background:${cc.color}"></span></span>
        <span class="winners-fav-meta">${meta}</span>
      </span>
      <span class="winners-fav-n">${n}</span>
    </button>`;
  }).join('');

  let detailHtml = '';
  if (selected) {
    const revealed = !!selected.revealed;
    const ranked = pickGroupsForComp(members, bets, selected.id, revealed, currentUserId);
    if (!revealed) {
      const mine = ranked.find(g => g.members.some(m => m.userId === currentUserId));
      const mineLabel = mine?.team ? escapeHtml(shortClubLabel(mine.team, shortByNorm)) : 'Pas de prono';
      detailHtml = `<div class="winners-detail">
        <strong>${escapeHtml(selected.nom)}</strong> — les pronos du groupe seront visibles après le verrouillage.
        <div class="winners-detail-people"><span class="winners-person">${winnersAvatar(members.find(m => m.userId === currentUserId) ?? { displayName: state.user.displayName, avatar: state.user.avatar, profileColor: state.user.profileColor })} Ton prono : ${mineLabel}</span></div>
      </div>`;
    } else {
      detailHtml = `<div class="winners-detail">
        <strong>${escapeHtml(selected.nom)}</strong> — répartition du groupe
        ${ranked.map(g => {
          const label = g.hidden ? 'Caché' : (g.team ? escapeHtml(shortClubLabel(g.team, shortByNorm)) : 'Pas de prono');
          const people = g.members.map(m => `<span class="winners-person">${winnersAvatar(m)} ${escapeHtml(m.displayName)}${m.userId === currentUserId ? ' (toi)' : ''}</span>`).join('');
          return `<div class="winners-detail-group"><strong>${label}</strong> · ${g.members.length}<div class="winners-detail-people">${people}</div></div>`;
        }).join('')}
      </div>`;
    }
  }

  const slips = members.map(m => {
    const isMe = m.userId === currentUserId;
    const picks = competitions.map(c => {
      const cc = compColors(c.code);
      const ranked = pickGroupsForComp([m], bets, c.id, !!c.revealed, currentUserId);
      const g = ranked[0];
      const canSee = c.revealed || isMe;
      const team = canSee ? (g?.team ?? '') : '';
      const empty = !team;
      const on = sameCompId(c.id, selectedId);
      const label = !canSee ? '…' : (team ? escapeHtml(shortClubLabel(team, shortByNorm)) : '—');
      const pts = canSee && g?.pointsByUser.get(m.userId) ? `<span class="winners-pick-pts">+${g.pointsByUser.get(m.userId)}</span>` : '';
      return `<div class="winners-pick${on ? ' is-on' : ''}${empty ? ' is-empty' : ''}" style="--pick-c:${cc.color}">
        <span class="winners-pick-code">${escapeHtml(compChipLabel(c.code))}</span>
        <span class="winners-pick-team">${label}</span>
        ${pts}
      </div>`;
    }).join('');
    return `<div class="winners-slip${isMe ? ' is-me' : ''}">
      <div class="winners-slip-av">${winnersAvatar(m)}</div>
      <div class="winners-slip-name">${escapeHtml(m.displayName)}${isMe ? '<span class="winners-you">Toi</span>' : ''}</div>
      <div class="winners-picks">${picks}</div>
    </div>`;
  }).join('');

  const allLocked = competitions.every(c => c.revealed);
  body.innerHTML = `
    <div class="section-card">
      <div class="section-head">
        <div class="jn">Favoris du groupe</div>
        <span class="winners-lock">${winnersLockSvg()} ${allLocked ? 'Verrouillés' : 'En cours'}</span>
      </div>
      <p class="profile-desc">Club le plus cité par compétition. Touche une ligne pour voir qui a choisi quoi.</p>
      <div class="winners-favs">${favRows}</div>
    </div>
    <div class="section-card">
      <div class="section-head">
        <div class="jn">Bulletins</div>
        <span class="winners-lock">+5 pts / bon vainqueur</span>
      </div>
      ${detailHtml}
      ${slips || '<div class="empty-state">Aucun membre dans ce groupe.</div>'}
    </div>`;

  body.querySelectorAll('[data-winners-comp]').forEach(btn => {
    btn.onclick = () => {
      const id = compId(btn.dataset.winnersComp);
      state.winnersCompId = sameCompId(id, state.winnersCompId) ? null : id;
      paintWinnersTab(body, state, payload, shortByNorm);
    };
  });
}

async function renderWinnersTab(body, state) {
  const data = await specialBets.group(state.group.id);
  if (state.standingsTab !== 'winners') return;
  paintWinnersTab(body, state, data, new Map());
  try {
    const clubs = await groups.clubs(state.group.id);
    if (state.standingsTab !== 'winners') return;
    const shortByNorm = new Map();
    for (const t of clubs) {
      if (t.team_name && t.short_name) shortByNorm.set(normTeamName(t.team_name), t.short_name);
    }
    if (shortByNorm.size) paintWinnersTab(body, state, data, shortByNorm);
  } catch { /* noms complets */ }
}

export async function renderStandingsScreen(el, state) {
  el.innerHTML = `<div class="tabs">
    <button class="tab ${state.standingsTab === 'general' ? 'active' : ''}" data-tab="general">Général</button>
    <button class="tab ${state.standingsTab === 'byComp' ? 'active' : ''}" data-tab="byComp">Par championnat</button>
    <button class="tab ${state.standingsTab === 'stats' ? 'active' : ''}" data-tab="stats">Stats</button>
    <button class="tab ${state.standingsTab === 'duel' ? 'active' : ''}" data-tab="duel">Duel</button>
    <button class="tab ${state.standingsTab === 'winners' ? 'active' : ''}" data-tab="winners">Vainqueurs</button>
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
        <p class="profile-desc">Tous championnats · pronos terminés + Mon 11 + vainqueurs (fin de saison)</p>
        ${standingsBlockHtml(rows, state.user.id, compColors('PL'))}
      </div>`;
    } else if (state.standingsTab === 'byComp') {
      await renderByCompTab(body, state);
    } else if (state.standingsTab === 'stats') {
      await renderStatsTab(body, state);
    } else if (state.standingsTab === 'duel') {
      await renderDuelTab(body, state);
    } else if (state.standingsTab === 'winners') {
      await renderWinnersTab(body, state);
    }
  } catch (err) {
    body.innerHTML = `<div class="empty-state">${err.message || 'Erreur de chargement'}</div>`;
  }
}

async function renderDuelTab(body, state) {
  const members = state.group?.members ?? [];
  if (members.length < 2) {
    body.innerHTML = '<div class="empty-state">Il faut au moins 2 joueurs dans le groupe pour lancer un duel.</div>';
    return;
  }

  if (!members.some(m => m.id === state.duelUserA)) {
    state.duelUserA = members.some(m => m.id === state.user.id) ? state.user.id : members[0].id;
  }
  if (state.duelUserB === state.duelUserA || !members.some(m => m.id === state.duelUserB)) {
    state.duelUserB = (members.find(m => m.id !== state.duelUserA) ?? members[0]).id;
  }

  const data = await standings.duel(state.group.id, state.duelUserA, state.duelUserB);

  body.innerHTML = `<div class="section-card">
      <div class="label">Choisir un duel</div>
      ${duelSelectorHtml(members, state.duelUserA, state.duelUserB)}
      <div class="duel-hint">Sur les journées pronostiquées en commun cette saison, tous championnats confondus.</div>
    </div>
    ${duelResultHtml(data)}`;

  body.querySelector('[data-duel-side="a"]').onclick = () => {
    state.duelUserA = cycleMember(members, state.duelUserA, state.duelUserB);
    renderDuelTab(body, state);
  };
  body.querySelector('[data-duel-side="b"]').onclick = () => {
    state.duelUserB = cycleMember(members, state.duelUserB, state.duelUserA);
    renderDuelTab(body, state);
  };
  const challengeBtn = body.querySelector('[data-duel-challenge]');
  if (challengeBtn) {
    challengeBtn.onclick = () => {
      state.duelUserB = cycleMember(members, state.duelUserB, state.duelUserA);
      renderDuelTab(body, state);
    };
  }
}

function cycleMember(members, currentId, excludeId) {
  const pool = members.filter(m => m.id !== excludeId);
  const idx = pool.findIndex(m => m.id === currentId);
  return pool[(idx + 1) % pool.length].id;
}

function duelSelectorHtml(members, userIdA, userIdB) {
  const a = members.find(m => m.id === userIdA);
  const b = members.find(m => m.id === userIdB);
  const side = (m, key) => `<button class="duel-player-btn" data-duel-side="${key}">
    <span class="duel-avatar" style="background:${m.profile_color || '#6B3FD6'}">${renderAvatarHtml(m.avatar, m.display_name, m.profile_color)}</span>
    <span class="duel-player-name">${escapeHtml(m.display_name)}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="#8B85A3" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </span>
  </button>`;
  return `<div class="duel-vs-row">${side(a, 'a')}<span class="duel-vs-badge">VS</span>${side(b, 'b')}</div>`;
}

function duelPct(count, total) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function duelCompareRow(label, a, b, suffix = '') {
  return `<div class="duel-compare-label">${label}</div>
    <div class="duel-compare-val ${a > b ? 'best' : ''}">${a}${suffix}</div>
    <div class="duel-compare-val ${b > a ? 'best' : ''}">${b}${suffix}</div>`;
}

function duelBreakdownBarHtml(s, total) {
  return `<div class="duel-breakdown-bar">
    <span style="width:${duelPct(s.exactCount, total)}%;background:var(--l1)"></span>
    <span style="width:${duelPct(s.diffCount, total)}%;background:#C9701F"></span>
    <span style="width:${duelPct(s.winnerCount, total)}%;background:var(--pl)"></span>
    <span style="width:${duelPct(s.missCount, total)}%;background:var(--border-soft)"></span>
  </div>`;
}

function duelResultHtml(data) {
  const { userA, userB, commonMatchesCount, duelScore, stats, rounds, lastMatch } = data;

  const challengeBtnHtml = `<button class="btn btn-primary duel-cta" data-duel-challenge>Défier un autre joueur</button>`;

  if (!commonMatchesCount) {
    return `<div class="section-card"><div class="empty-state">Aucun match pronostiqué en commun pour l'instant.</div></div>${challengeBtnHtml}`;
  }

  const totalRounds = duelScore.a + duelScore.b;
  const pctA = totalRounds > 0 ? Math.round((duelScore.a / totalRounds) * 100) : 50;
  const leadDiff = Math.abs(duelScore.a - duelScore.b);
  const leadHtml = duelScore.a === duelScore.b
    ? `<div class="duel-lead">🤝 Duel à égalité</div>`
    : `<div class="duel-lead">🏆 ${duelScore.a > duelScore.b ? escapeHtml(userA.displayName) : escapeHtml(userB.displayName)} mène le duel de ${leadDiff} journée${leadDiff > 1 ? 's' : ''}</div>`;

  const historyRows = [...rounds].reverse().map(r => `<div class="duel-history-row">
    <span class="duel-history-round">${r.label}</span>
    <span class="duel-history-score">${r.pointsA} – ${r.pointsB}</span>
    <span class="duel-history-crown">${r.winner === 'draw' ? '🤝' : '👑'}</span>
  </div>`).join('');

  const lastMatchHtml = lastMatch ? (() => {
    const cc = compColors(lastMatch.compCode);
    const predRow = (u, side) => `<div class="duel-pred-row ${side.detail === 'exact' ? 'win' : ''}">
      <span class="duel-pred-avatar" style="background:${u.profileColor || '#6B3FD6'}">${renderAvatarHtml(u.avatar, u.displayName, u.profileColor)}</span>
      <span class="duel-pred-text">${escapeHtml(u.displayName)} a joué ${side.homeScore}-${side.awayScore}</span>
      <span class="duel-pred-pts">+${side.points ?? 0} pt${(side.points ?? 0) > 1 ? 's' : ''}</span>
    </div>`;
    return `<div class="section-card">
      <div class="label">Face-à-face sur un match</div>
      <div class="duel-subhint">Dernier match pronostiqué par les deux · ${lastMatch.compCode} · J${lastMatch.matchday}</div>
      <div class="duel-match-teams">
        <div class="duel-match-team">
          <span class="duel-match-crest" style="background:${cc.bg};color:${cc.color}">${clubCrestLetters(lastMatch.homeTeam)}</span>
          <span class="duel-match-team-name">${lastMatch.homeTeam}</span>
        </div>
        <span class="duel-match-score">${lastMatch.homeScore}-${lastMatch.awayScore}</span>
        <div class="duel-match-team">
          <span class="duel-match-crest" style="background:${cc.bg};color:${cc.color}">${clubCrestLetters(lastMatch.awayTeam)}</span>
          <span class="duel-match-team-name">${lastMatch.awayTeam}</span>
        </div>
      </div>
      ${predRow(userA, lastMatch.a)}
      ${predRow(userB, lastMatch.b)}
    </div>`;
  })() : '';

  return `
    <div class="section-card">
      <div class="label">Score du duel</div>
      <div class="duel-subhint">Journées gagnées sur les pronostics communs</div>
      <div class="duel-score-row">
        <div class="duel-score-side">
          <span class="duel-score-num a">${duelScore.a}</span>
          <span class="duel-score-name">${escapeHtml(userA.displayName)}</span>
        </div>
        <span class="duel-score-sep">—</span>
        <div class="duel-score-side">
          <span class="duel-score-num b">${duelScore.b}</span>
          <span class="duel-score-name">${escapeHtml(userB.displayName)}</span>
        </div>
      </div>
      <div class="duel-bar"><span class="a" style="width:${pctA}%"></span><span class="b" style="width:${100 - pctA}%"></span></div>
      ${leadHtml}
    </div>

    <div class="section-card">
      <div class="label">Stats comparées</div>
      <div class="duel-compare-grid">
        <div></div>
        <div class="duel-compare-head"><span class="duel-compare-avatar" style="background:${userA.profileColor || '#6B3FD6'}">${renderAvatarHtml(userA.avatar, userA.displayName, userA.profileColor)}</span><span class="name">${escapeHtml(userA.displayName)}</span></div>
        <div class="duel-compare-head"><span class="duel-compare-avatar" style="background:${userB.profileColor || '#6B3FD6'}">${renderAvatarHtml(userB.avatar, userB.displayName, userB.profileColor)}</span><span class="name">${escapeHtml(userB.displayName)}</span></div>
        <div class="duel-compare-sep"></div>
        ${duelCompareRow('Points cumulés', stats.a.points, stats.b.points)}
        ${duelCompareRow('Moy. pts/match', stats.a.avgPerMatch, stats.b.avgPerMatch)}
        ${duelCompareRow('% Score exact', stats.a.exactPct, stats.b.exactPct, '%')}
        ${duelCompareRow('% Bon résultat', stats.a.resultPct, stats.b.resultPct, '%')}
      </div>
    </div>

    <div class="section-card">
      <div class="label">Détail par type de pari</div>
      <div class="duel-subhint">Répartition des ${commonMatchesCount} pronostics communs</div>
      <div class="duel-breakdown-row"><span class="duel-breakdown-name">${escapeHtml(userA.displayName)}</span>${duelBreakdownBarHtml(stats.a, commonMatchesCount)}</div>
      <div class="duel-breakdown-row"><span class="duel-breakdown-name">${escapeHtml(userB.displayName)}</span>${duelBreakdownBarHtml(stats.b, commonMatchesCount)}</div>
      <div class="duel-legend">
        <div class="duel-legend-item"><span class="duel-legend-dot" style="background:var(--l1)"></span>Exact</div>
        <div class="duel-legend-item"><span class="duel-legend-dot" style="background:#C9701F"></span>Écart</div>
        <div class="duel-legend-item"><span class="duel-legend-dot" style="background:var(--pl)"></span>Vainqueur</div>
        <div class="duel-legend-item"><span class="duel-legend-dot" style="background:var(--border-soft)"></span>Raté</div>
      </div>
    </div>

    <div class="section-card">
      <div class="label">Historique journée par journée</div>
      ${historyRows || '<div class="empty-state">Aucune journée commune terminée</div>'}
    </div>

    ${lastMatchHtml}

    ${challengeBtnHtml}
  `;
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

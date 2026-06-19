import { standings, compColors, compLogoHtml, showToast } from './api.js';
import { renderAvatarHtml } from './avatars.js';

function rankingRowsHtml(rows, currentUserId) {
  return rows.map((r, i) => {
    const isMe = r.userId === currentUserId;
    const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1;
    const extras = [
      r.xiPoints ? `11 : +${r.xiPoints}` : '',
      r.specialPoints ? `Vainqueur : +${r.specialPoints}` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="row ${isMe ? 'me' : ''}">
      <div class="medal">${medal}</div>
      <div class="name">${r.displayName}
        ${extras ? `<div class="sub-pts">${extras}</div>` : ''}
      </div>
      <div class="pts">${r.totalPoints} pts</div>
    </div>`;
  }).join('');
}

function avgChartHtml(members) {
  if (!members.length) return '<div class="empty-state">Pas encore de stats</div>';
  const max = Math.max(...members.map(m => m.avgPerMatch), 0.1);
  return `<div class="stats-chart">
    <div class="stats-chart-title">Moyenne de points par match</div>
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
  if (!evolution.length) return '';
  const last = evolution[evolution.length - 1];
  return `<div class="stats-evolution">
    <div class="stats-chart-title">Évolution du classement (dernière journée : ${last.label})</div>
    <div class="evo-rows">${last.rankings.map(r => {
      const m = members.find(x => x.userId === r.userId);
      const isMe = r.userId === currentUserId;
      return `<div class="evo-row ${isMe ? 'me' : ''}">
        <span class="evo-rank">#${r.rank}</span>
        <span class="evo-name">${r.displayName}</span>
        <span class="evo-pts">${r.total} pts</span>
      </div>`;
    }).join('')}</div>
  </div>`;
}

function matchdayPointsHtml(pointsByMatchday, members) {
  if (!pointsByMatchday.length) return '';
  const recent = pointsByMatchday.slice(-5);
  return `<div class="stats-matchdays">
    <div class="stats-chart-title">Points par journée (5 dernières)</div>
    ${recent.map(round => `
      <div class="md-round">
        <div class="md-round-label">${round.label}</div>
        <div class="md-round-scores">${members.map(m => {
          const pts = round.points[m.userId] ?? 0;
          return `<span class="md-score ${pts > 0 ? 'positive' : ''}">${m.displayName.split(' ')[0]}: ${pts}</span>`;
        }).join('')}</div>
      </div>
    `).join('')}
  </div>`;
}

function playerCardsHtml(members, currentUserId) {
  return `<div class="player-cards-section">
    <div class="stats-chart-title">Fiche joueur</div>
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
        <p class="profile-desc">Tous championnats confondus · pronos + Mon 11 + vainqueurs</p>
        ${rows.length ? rankingRowsHtml(rows, state.user.id) : '<div class="empty-state">Aucun point pour l\'instant</div>'}
      </div>`;
    } else if (state.standingsTab === 'byComp') {
      const comps = state.competitions;
      if (!comps.length) {
        body.innerHTML = '<div class="empty-state">Aucun championnat suivi</div>';
        return;
      }
      const blocks = await Promise.all(comps.map(async (c) => {
        const rows = await standings.general(state.group.id, c.id);
        const cc = compColors(c.code);
        return `<div class="section-card standings-comp-block">
          <div class="section-head comp-head-row">
            ${compLogoHtml(c, 'comp-head-logo')}
            <div class="jn">${c.nom}</div>
          </div>
          ${rows.length ? rankingRowsHtml(rows, state.user.id) : '<div class="empty-state">Aucun point</div>'}
        </div>`;
      }));
      body.innerHTML = blocks.join('');
    } else if (state.standingsTab === 'stats') {
      const data = await standings.analytics(state.group.id);
      body.innerHTML = `
        <div class="section-card">${avgChartHtml(data.members)}</div>
        <div class="section-card">${evolutionHtml(data.matchdayEvolution, data.members, state.user.id)}</div>
        <div class="section-card">${matchdayPointsHtml(data.pointsByMatchday, data.members)}</div>
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
    const active = c.id === state.activeComp ? 'active' : '';
    const style = c.id === state.activeComp ? `background:${c.couleur};color:white` : '';
    return `<button class="comp-pill ${active}" data-comp="${c.id}" style="${style}">
      ${compLogoHtml(c, 'comp-pill-logo')} ${c.nom}
    </button>`;
  }).join('')}</div>`;
}

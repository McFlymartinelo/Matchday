import { standings, teamCrest, compColors, compLogoHtml, showToast, buildTeamLogoMap, normTeamName } from './api.js';

function renderLeagueTable(comp, rows, logoMap) {
  const cc = compColors(comp.code);
  const total = rows.length;
  const relegateFrom = Math.max(total - 2, 1);

  if (!rows.length) {
    return `<div class="section-card">
      <div class="section-head">
        <div class="jn">
          <div class="comp-flag" style="background:${comp.couleurBg ?? cc.bg};color:${comp.couleur ?? cc.color}">${comp.code}</div>
          ${compLogoHtml(comp, 'comp-head-logo')} ${comp.nom}
        </div>
      </div>
      <div class="empty-state">Classement pas encore synchronisé.<br>La mise à jour se fait 1×/jour via BSD.</div>
    </div>`;
  }

  return `<div class="section-card league-table-card" style="--league-color:${comp.couleur ?? cc.color};--league-bg:${comp.couleurBg ?? cc.bg}">
    <div class="section-head">
      <div class="jn">
        <div class="comp-flag" style="background:${comp.couleurBg ?? cc.bg};color:${comp.couleur ?? cc.color}">${comp.code}</div>
        ${compLogoHtml(comp, 'comp-head-logo')} ${comp.nom}
      </div>
      <div class="countdown-bubble" style="color:${comp.couleur ?? cc.color};background:${comp.couleurBg ?? cc.bg}">
        ${rows.length} équipes
      </div>
    </div>
    <div class="league-table-head">
      <span>#</span><span>Club</span><span>J</span><span>Diff</span><span>Pts</span>
    </div>
    ${rows.map(r => {
      const gd = (r.goals_for ?? 0) - (r.goals_against ?? 0);
      const gdStr = gd > 0 ? `+${gd}` : String(gd);
      const isLeader = r.position === 1;
      const isRelegation = r.position >= relegateFrom && total >= 5;
      const teamId = r.team_id ?? logoMap.get(normTeamName(r.team_name));
      return `<div class="league-row ${isLeader ? 'leader' : ''} ${isRelegation ? 'relegation' : ''}">
        <span class="league-pos">${r.position}</span>
        <span class="league-team">
          ${teamCrest(r.team_name, comp.code, teamId)}
          <span class="league-team-name" title="${r.team_name}">${r.team_name}</span>
        </span>
        <span class="league-stat">${r.played ?? 0}</span>
        <span class="league-stat ${gd > 0 ? 'positive' : gd < 0 ? 'negative' : ''}">${gdStr}</span>
        <span class="league-pts">${r.points ?? 0}</span>
      </div>`;
    }).join('')}
    ${total >= 5 ? `<div class="league-legend">
      <span><span class="legend-dot leader"></span> Leader</span>
      <span><span class="legend-dot relegation"></span> Relégation</span>
    </div>` : ''}
  </div>`;
}

export async function renderChampionships(el, state) {
  el.innerHTML = '<div class="empty-state">Chargement des classements…</div>';

  try {
    const [data, logoMap] = await Promise.all([
      standings.allOfficial(state.group.id),
      buildTeamLogoMap(state.group.id),
    ]);
    const activeId = state.activeComp ?? state.competitions[0]?.id;
    const filtered = activeId
      ? data.filter(d => d.competition.id === activeId)
      : data;

    if (!data.length) {
      el.innerHTML = `<div class="section-card"><div class="empty-state">Aucun championnat suivi par ce groupe.</div></div>`;
      return;
    }

    el.innerHTML = `
      <div class="section-card" style="padding-bottom:12px">
        <div class="section-head" style="margin-bottom:0">
          <div class="jn">Classements officiels</div>
        </div>
        <p class="profile-desc" style="margin-top:8px;margin-bottom:0">Tableaux en direct des championnats suivis par ton groupe.</p>
      </div>
      ${(filtered.length ? filtered : data).map(d => renderLeagueTable(d.competition, d.rows, logoMap)).join('')}
    `;
  } catch (err) {
    el.innerHTML = `<div class="section-card"><div class="empty-state">${err.message}</div></div>`;
    showToast(err.message);
  }
}

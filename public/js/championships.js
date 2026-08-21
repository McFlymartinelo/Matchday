import { standings, teamCrest, compColors, compLogoHtml, showToast, buildTeamLogoMap, normTeamName, compId, sameCompId } from './api.js';

const ZONE_LEGEND = [
  { id: 'cl', label: 'LDC' },
  { id: 'el', label: 'Ligue Europa' },
  { id: 'ecl', label: 'Conférence' },
  { id: 'relq', label: 'Barrage' },
  { id: 'rel', label: 'Relégation' },
];

function zoneBucket(zoneKey, zoneLabel = '') {
  const key = String(zoneKey ?? '').toLowerCase();
  const label = String(zoneLabel ?? '').toLowerCase();
  if (key === 'cl' || key === 'clq' || key === 'ucl' || label.includes('champions')) return 'cl';
  if (key === 'el' || key === 'elq' || key === 'uel' || (label.includes('europa') && !label.includes('conference'))) return 'el';
  if (key === 'uecl' || key === 'ecl' || key === 'coe' || label.includes('conference') || label.includes('conférence')) return 'ecl';
  if (key === 'relq' || (label.includes('playoff') && label.includes('releg'))) return 'relq';
  if (key === 'rel' || label.includes('relegation') || label.includes('relégation')) return 'rel';
  return null;
}

function renderLeagueTable(comp, rows, logoMap) {
  const cc = compColors(comp.code);

  if (!rows.length) {
    return `<div class="section-card">
      <div class="section-head">
        <div class="jn">
          <div class="comp-flag" style="background:${comp.couleurBg ?? cc.bg};color:${comp.couleur ?? cc.color}">${comp.code}</div>
          ${compLogoHtml(comp, 'comp-head-logo')} ${comp.nom}
        </div>
      </div>
      <div class="empty-state">Classement pas encore synchronisé.<br>La mise à jour se fait chaque heure via BSD.</div>
    </div>`;
  }

  const presentZones = new Set(rows.map(r => zoneBucket(r.zone_key, r.zone_label)).filter(Boolean));
  const legend = ZONE_LEGEND.filter(z => presentZones.has(z.id));

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
      const zone = zoneBucket(r.zone_key, r.zone_label);
      const teamId = r.team_id ?? logoMap.get(normTeamName(r.team_name));
      const zoneTitle = r.zone_label ? ` title="${r.zone_label}"` : '';
      return `<div class="league-row${zone ? ` zone-${zone}` : ''}"${zoneTitle}>
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
    ${legend.length ? `<div class="league-legend">${legend.map(z =>
      `<span><span class="legend-dot zone-${z.id}"></span> ${z.label}</span>`
    ).join('')}</div>` : ''}
  </div>`;
}

export async function renderChampionships(el, state) {
  el.innerHTML = '<div class="empty-state">Chargement des classements…</div>';

  try {
    const [data, logoMap] = await Promise.all([
      standings.allOfficial(state.group.id),
      buildTeamLogoMap(state.group.id),
    ]);
    const activeId = compId(state.activeComp) ?? compId(state.competitions[0]?.id);
    const filtered = activeId
      ? data.filter(d => sameCompId(d.competition.id, activeId))
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

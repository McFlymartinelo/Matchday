import { standings, teamCrest, compColors, compLogoHtml, showToast, buildTeamLogoMap, normTeamName, compId, sameCompId, escapeHtml } from './api.js';

const ZONE_LEGEND = [
  { id: 'cl', label: 'LDC' },
  { id: 'el', label: 'Ligue Europa' },
  { id: 'ecl', label: 'Conférence' },
  { id: 'relq', label: 'Barrage' },
  { id: 'rel', label: 'Relégation' },
];

const ZONE_LEGEND_LDC = [
  { id: 'cl', label: '8es de finale' },
  { id: 'po', label: 'Play-offs' },
  { id: 'rel', label: 'Éliminé' },
];

function zoneBucket(zoneKey, zoneLabel = '') {
  const key = String(zoneKey ?? '').toLowerCase();
  const label = String(zoneLabel ?? '').toLowerCase();
  if (key === 'po' || key === 'kpo') return 'po';
  if (
    (label.includes('play-off') || label.includes('playoff') || label.includes('play offs'))
    && !label.includes('releg')
  ) return 'po';
  if (key === 'cl' || key === 'clq' || key === 'ucl' || label.includes('champions')) return 'cl';
  if (key === 'el' || key === 'elq' || key === 'uel' || (label.includes('europa') && !label.includes('conference'))) return 'el';
  if (key === 'uecl' || key === 'ecl' || key === 'coe' || label.includes('conference') || label.includes('conférence')) return 'ecl';
  if (key === 'relq' || (label.includes('playoff') && label.includes('releg'))) return 'relq';
  if (key === 'rel' || label.includes('relegation') || label.includes('relégation')) return 'rel';
  return null;
}

function ldcZoneFromRow(row) {
  const p = Number(row.position);
  if (p >= 1 && p <= 8) return 'cl';
  if (p >= 9 && p <= 24) return 'po';
  if (p >= 25) return 'rel';
  return zoneBucket(row.zone_key, row.zone_label);
}

function formStripHtml(form) {
  if (!form?.length) return '';
  return `<div class="league-form" hidden style="--form-n:${form.length}">${form.map((m) => {
    const title = `${m.venue === 'D' ? 'Domicile' : 'Extérieur'} · ${escapeHtml(m.opponent)} ${m.gf}-${m.ga}`;
    const oppId = m.opponent_id ? ` data-opp-id="${Number(m.opponent_id)}"` : '';
    return `<div class="league-form-cell"${oppId} data-opp-key="${escapeHtml(normTeamName(m.opponent))}" title="${title}">
      <span class="league-form-dot ${m.result}">${m.result}</span>
      <span class="league-form-score">${m.gf}-${m.ga}</span>
      <span class="league-form-opp">${m.venue} ${escapeHtml(m.opp)}</span>
    </div>`;
  }).join('')}</div>`;
}

function bindFormOpponentHover(card) {
  const clear = () => {
    card.querySelectorAll('.league-row.is-form-target').forEach((row) => {
      row.classList.remove('is-form-target');
    });
    card.querySelectorAll('.league-form-cell.is-hot').forEach((cell) => {
      cell.classList.remove('is-hot');
    });
  };

  card.querySelectorAll('.league-form-cell').forEach((cell) => {
    const highlight = (on) => {
      clear();
      if (!on) return;
      const oppId = cell.dataset.oppId;
      const oppKey = cell.dataset.oppKey;
      cell.classList.add('is-hot');
      card.querySelectorAll('.league-row[data-team-key]').forEach((row) => {
        const byId = oppId && row.dataset.teamId
          ? row.dataset.teamId === oppId
          : false;
        const byKey = !row.dataset.teamId || !oppId
          ? Boolean(oppKey && row.dataset.teamKey === oppKey)
          : false;
        if (byId || byKey) row.classList.add('is-form-target');
      });
    };
    cell.addEventListener('pointerenter', () => highlight(true));
    cell.addEventListener('pointerleave', () => highlight(false));
  });
}

function bindLeagueFormToggles(root) {
  root.querySelectorAll('.league-table-card').forEach((card) => {
    bindFormOpponentHover(card);
    card.querySelectorAll('[data-form-toggle]').forEach((row) => {
      const toggle = () => {
        const wrap = row.closest('.league-row-block');
        const strip = wrap?.querySelector('.league-form');
        if (!strip) return;
        const willOpen = strip.hasAttribute('hidden');
        card.querySelectorAll('.league-form').forEach((el) => { el.hidden = true; });
        card.querySelectorAll('.league-row.is-open').forEach((el) => el.classList.remove('is-open'));
        card.querySelectorAll('.league-row.is-form-target').forEach((el) => el.classList.remove('is-form-target'));
        if (willOpen) {
          strip.hidden = false;
          row.classList.add('is-open');
        }
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
  });
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

  const isLdc = String(comp.code ?? '').toUpperCase() === 'LDC';
  const presentZones = new Set(rows.map(r => (isLdc ? ldcZoneFromRow(r) : zoneBucket(r.zone_key, r.zone_label))).filter(Boolean));
  const legendSrc = isLdc ? ZONE_LEGEND_LDC : ZONE_LEGEND;
  const legend = legendSrc.filter(z => presentZones.has(z.id));

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
      const zone = isLdc ? ldcZoneFromRow(r) : zoneBucket(r.zone_key, r.zone_label);
      const teamId = r.team_id ?? logoMap.get(normTeamName(r.team_name));
      const zoneLabel = isLdc
        ? (ZONE_LEGEND_LDC.find(z => z.id === zone)?.label ?? '')
        : (r.zone_label ?? '');
      const zoneTitle = zoneLabel ? ` title="${escapeHtml(zoneLabel)}"` : '';
      const hasForm = Array.isArray(r.form) && r.form.length > 0;
      const rowClass = [
        'league-row',
        zone ? `zone-${zone}` : '',
        hasForm ? 'league-row-clickable' : '',
      ].filter(Boolean).join(' ');
      const teamKey = escapeHtml(normTeamName(r.team_name));
      const teamAttr = ` data-team-key="${teamKey}"${teamId ? ` data-team-id="${Number(teamId)}"` : ''}`;
      const toggleAttrs = hasForm ? ' data-form-toggle role="button" tabindex="0"' : '';
      return `<div class="league-row-block">
        <div class="${rowClass}"${teamAttr}${toggleAttrs}${zoneTitle}>
        <span class="league-pos">${r.position}</span>
        <span class="league-team">
          ${teamCrest(r.team_name, comp.code, teamId)}
          <span class="league-team-name" title="${escapeHtml(r.team_name)}">${escapeHtml(r.team_name)}</span>
        </span>
        <span class="league-stat">${r.played ?? 0}</span>
        <span class="league-stat ${gd > 0 ? 'positive' : gd < 0 ? 'negative' : ''}">${gdStr}</span>
        <span class="league-pts">${r.points ?? 0}</span>
      </div>
      ${formStripHtml(r.form)}
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
    bindLeagueFormToggles(el);
  } catch (err) {
    el.innerHTML = `<div class="section-card"><div class="empty-state">${escapeHtml(err.message)}</div></div>`;
    showToast(err.message);
  }
}

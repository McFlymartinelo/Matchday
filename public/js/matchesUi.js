import {
  matches, showToast, compColors, teamCrest, formatCountdown, formatKickoffLabel,
  initials, buildTeamLogoMap, normTeamName, findCompetition, escapeHtml,
} from './api.js';
import { renderAvatarHtml } from './avatars.js';

const pendingPredictions = new Map();
const autoSaveTimers = new Map();
let lockRefreshTimer = null;
let ui = { setActiveComp: () => {}, renderApp: async () => {} };

const LOCKED_STATUSES = new Set(['live', 'inprogress', 'finished', 'FT', 'ended']);

export function resetMatchesUi() {
  pendingPredictions.clear();
  stopMatchLockRefresh();
}

function pickDisplayDuplicate(a, b) {
  if (a.prediction && !b.prediction) return a;
  if (b.prediction && !a.prediction) return b;
  return a.id < b.id ? a : b;
}

function dedupeMatchesForDisplay(list) {
  const byKey = new Map();
  for (const m of list) {
    const key = `${m.competition_id}|${m.matchday ?? ''}|${normTeamName(m.home_team_name)}|${normTeamName(m.away_team_name)}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? pickDisplayDuplicate(existing, m) : m);
  }
  return [...byKey.values()];
}

function resolveBsdTeamId(match, side, logoMap) {
  const direct = side === 'home' ? match.home_bsd_team_id : match.away_bsd_team_id;
  if (direct) return Number(direct);
  const name = side === 'home' ? match.home_team_name : match.away_team_name;
  return logoMap.get(normTeamName(name)) ?? null;
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

async function ensureMatchVisible(state, matchId) {
  if (!matchId || !state.group?.id) return false;

  let list = await matches.list(state.group.id, state.activeComp ? { competitionId: state.activeComp } : {});
  if (list.some(m => m.id === matchId)) return true;

  const all = await matches.list(state.group.id, {});
  const found = all.find(m => m.id === matchId);
  if (!found) return false;

  ui.setActiveComp(found.competition_id);
  return true;
}

async function focusMatchAfterRender(state, matchId, attempt = 0) {
  if (!matchId) return;
  if (scrollToMatchCard(matchId)) return;

  if (attempt >= 4) {
    showToast('Match introuvable — calendrier peut-être expiré', 'error');
    return;
  }

  if (attempt === 1) {
    const ok = await ensureMatchVisible(state, matchId);
    if (ok) {
      state.scrollToMatchId = matchId;
      await ui.renderApp();
      return;
    }
  }

  setTimeout(() => focusMatchAfterRender(state, matchId, attempt + 1), 200);
}

async function onPronosToggleClick(e, state) {
  if (e.target.closest('input, button')) return;
  const card = e.currentTarget;
  const hint = card.querySelector('.finished-toggle-hint');
  const existing = card.querySelector('.pronos-panel');

  if (existing) {
    existing.remove();
    card.classList.remove('pronos-open');
    if (hint) hint.textContent = 'Voir les pronos du groupe';
    return;
  }

  const matchId = Number(card.dataset.match);
  card.classList.add('pronos-open');
  if (hint) hint.textContent = 'Fermer ▲';

  const panel = document.createElement('div');
  panel.className = 'pronos-panel';
  panel.innerHTML = '<div class="pronos-loading">Chargement…</div>';
  card.appendChild(panel);

  try {
    const { predictions } = await matches.groupPredictions(state.group.id, matchId);
    panel.innerHTML = pronosPanelHtml(predictions, card.dataset.compColor);
  } catch (err) {
    panel.remove();
    card.classList.remove('pronos-open');
    if (hint) hint.textContent = 'Voir les pronos du groupe';
    showToast(err.message, 'error');
  }
}

function pronosPanelHtml(predictions, compColor) {
  if (!predictions.length) {
    return '<div class="pronos-panel-empty">Aucun pronostic posé</div>';
  }
  const LABELS = { exact: 'Score exact', diff: 'Bon écart', winner: 'Bon vainqueur', miss: 'Raté' };
  const rows = predictions.map(p => {
    const pts = p.points ?? null;
    const avatarContent = (p.avatar && p.avatar.trim())
      ? renderAvatarHtml(p.avatar, p.display_name, p.profile_color, 'sm')
      : initials(p.display_name);
    const ptsHtml = pts !== null
      ? `<span class="prono-pts" style="color:${pts > 0 ? compColor : 'var(--ink-soft)'}">${pts} pt${pts !== 1 ? 's' : ''}</span>`
      : '';
    const scoreText = p.home_score !== null
      ? `${p.home_score}–${p.away_score}${p.points_detail ? ` · ${LABELS[p.points_detail] ?? p.points_detail}` : ''}`
      : null;
    return `<div class="prono-row">
      <span class="prono-avatar">${avatarContent}</span>
      <div class="prono-info">
        <span class="prono-name">${escapeHtml(p.display_name)}</span>
        <span class="prono-score${scoreText ? '' : ' prono-none'}">${scoreText ?? 'Pas de prono'}</span>
      </div>
      ${ptsHtml}
    </div>`;
  }).join('');
  return `<div class="pronos-panel-header">Pronos du groupe · ${predictions.length}</div>${rows}`;
}

export async function renderMatches(el, state, hooks = {}) {
  ui = {
    setActiveComp: hooks.setActiveComp ?? ui.setActiveComp,
    renderApp: hooks.renderApp ?? ui.renderApp,
  };
  pendingPredictions.clear();
  for (const timer of autoSaveTimers.values()) clearTimeout(timer);
  autoSaveTimers.clear();
  stopMatchLockRefresh();
  el.innerHTML = '<div class="empty-state">Chargement…</div>';
  try {
    const pendingScrollId = state.scrollToMatchId;
    if (pendingScrollId) await ensureMatchVisible(state, pendingScrollId);

    const params = state.activeComp ? { competitionId: state.activeComp } : {};
    const [rawList, logoMap] = await Promise.all([
      matches.list(state.group.id, params),
      buildTeamLogoMap(state.group.id),
    ]);
    const matchList = dedupeMatchesForDisplay(rawList);

    if (!matchList.length) {
      el.innerHTML = `<div class="section-card"><div class="empty-state">Aucun calendrier disponible pour ce championnat.<br>La sync BSD se fait toutes les 6h.</div></div>`;
      return;
    }

    const comp = findCompetition(state.competitions, state.activeComp) ?? matchList[0];
    const season = matchList[0].season ?? comp.saisonActive ?? comp.saison_active ?? '2025-2026';
    const calendarClosed = matchList.every(m => m.calendarClosed ?? m.isLocked);
    const closedBanner = calendarClosed
      ? `<div class="calendar-closed-banner">
          <strong>Saison ${escapeHtml(season)} — calendrier fermé</strong>
          <span>Le calendrier 2026-2027 n'est pas encore disponible sur BSD. Tu peux consulter la saison passée ci-dessous, mais les pronostics sont terminés.</span>
        </div>`
      : '';

    const byMatchday = {};
    for (const m of matchList) {
      const s = m.season ?? m.saison_active ?? '2025-2026';
      const md = m.matchday ?? '?';
      const key = `${s}|${md}`;
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

    const relevantPronoIds = new Set();
    {
      const byCompId = {};
      for (const m of matchList) (byCompId[m.competition_id] ??= []).push(m);
      for (const compMatches of Object.values(byCompId)) {
        const openByMd = {}, hasLockedInMd = {};
        for (const m of compMatches) {
          const md = m.matchday ?? '?';
          if (!m.isLocked) (openByMd[md] ??= []).push(m);
          else hasLockedInMd[md] = true;
        }
        const openMds = Object.keys(openByMd).sort((a, b) => Number(a) - Number(b));
        if (!openMds.length) continue;
        const currentMd = openMds[0];
        for (const m of openByMd[currentMd]) relevantPronoIds.add(m.id);
        if (hasLockedInMd[currentMd] && openMds[1]) {
          for (const m of openByMd[openMds[1]]) relevantPronoIds.add(m.id);
        }
      }
    }

    const currentDayOpen = matchList.filter(m => !m.isLocked && relevantPronoIds.has(m.id));
    const totalOpen = currentDayOpen.length;
    const totalPending = currentDayOpen.filter(m => {
      const h = m.prediction?.home_score ?? '';
      const a = m.prediction?.away_score ?? '';
      return h === '' || a === '';
    }).length;
    const totalFilled = totalOpen - totalPending;
    const pct = totalOpen > 0 ? Math.round((totalFilled / totalOpen) * 100) : 100;

    const tabsHtml = `<div class="matches-tabs">
      <button class="matches-tab${state.matchesTab === 'pronostiquer' ? ' active' : ''}" data-matches-tab="pronostiquer">
        À pronostiquer${totalPending > 0 ? `<span class="matches-tab-badge">${totalPending}</span>` : ''}
      </button>
      <button class="matches-tab${state.matchesTab === 'tous' ? ' active' : ''}" data-matches-tab="tous">
        Tous les matchs
      </button>
    </div>`;

    let bannerHtml = '';
    if (state.matchesTab === 'pronostiquer' && totalOpen > 0) {
      bannerHtml = `<div class="pronos-progress-banner">
        <div class="pronos-progress-info">
          <div class="pronos-progress-title">${totalPending > 0 ? `${totalPending} match${totalPending > 1 ? 's' : ''} sans pronostic` : 'Tous les pronos sont posés\u00a0!'}</div>
          <div class="pronos-progress-sub">${totalOpen} ouvert${totalOpen > 1 ? 's' : ''} · ${totalFilled} renseigné${totalFilled > 1 ? 's' : ''}</div>
        </div>
        <div class="pronos-progress-pct">${pct}%</div>
      </div>`;
    }

    let displayedMatchdays = sortedMatchdays;
    if (state.matchesTab === 'pronostiquer') {
      displayedMatchdays = sortedMatchdays
        .map(([key, ms]) => [key, ms.filter(m => relevantPronoIds.has(m.id))])
        .filter(([, ms]) => ms.length > 0);
    }

    const sectionsHtml = displayedMatchdays.map(([key, ms]) => {
      const [mdSeason, md] = key.split('|');
      const sectionComp = state.competitions.find(c => c.id === ms[0].competition_id) ?? ms[0];
      const cc = compColors(sectionComp.code ?? sectionComp.comp_code);
      const openMatches = ms.filter(m => !m.isLocked);
      const countdown = openMatches.find(m => formatCountdown(m.kickoff_at));
      const cd = countdown ? formatCountdown(countdown.kickoff_at) : '';
      const allLocked = openMatches.length === 0;
      const pendingInSection = openMatches.filter(m => {
        const h = m.prediction?.home_score ?? '';
        const a = m.prediction?.away_score ?? '';
        return h === '' || a === '';
      }).length;
      const sectionBadge = state.matchesTab === 'pronostiquer' && pendingInSection > 0
        ? `<span class="matches-section-badge" style="background:${cc.bg};color:${cc.color}">${pendingInSection} à faire</span>`
        : '';

      return `<div class="section-card matchday-section ${allLocked ? 'matchday-past' : 'matchday-open'}" data-matchday="${md}" data-season="${escapeHtml(mdSeason)}">
        <div class="section-head">
          <div class="jn"><div class="comp-flag" style="background:${cc.bg};color:${cc.color}">${escapeHtml(sectionComp.code ?? sectionComp.comp_code)}</div>Journée ${escapeHtml(md)}<span class="season-tag">${escapeHtml(mdSeason)}</span></div>
          ${sectionBadge || (cd ? `<div class="countdown-bubble">${cd}</div>` : allLocked ? `<div class="countdown-bubble locked">${calendarClosed ? 'Fermée' : 'Terminée'}</div>` : '')}
        </div>
        ${ms.map(m => matchCardHtml(m, cc, logoMap)).join('')}
      </div>`;
    }).join('');

    const emptyProno = state.matchesTab === 'pronostiquer' && displayedMatchdays.length === 0
      ? `<div class="section-card"><div class="empty-state">Aucun match à pronostiquer pour l'instant.</div></div>`
      : '';

    el.innerHTML = `${tabsHtml}${closedBanner}${bannerHtml}${sectionsHtml}${emptyProno}`;

    el.querySelectorAll('[data-matches-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.matchesTab = btn.dataset.matchesTab;
        renderMatches(el, state, hooks);
      });
    });

    el.querySelectorAll('.score-pill input').forEach(input => {
      input.addEventListener('input', e => onScoreInput(e, state));
      input.addEventListener('change', e => onScoreInput(e, state));
    });

    el.querySelectorAll('.match-card-locked').forEach(card => bindPronosToggle(card, state));

    startMatchLockRefresh(state);

    if (state.scrollToMatchId) {
      const id = state.scrollToMatchId;
      state.scrollToMatchId = null;
      focusMatchAfterRender(state, id);
    } else {
      const firstOpen = el.querySelector('.matchday-section.matchday-open');
      if (firstOpen) {
        requestAnimationFrame(() => {
          const top = firstOpen.getBoundingClientRect().top + window.scrollY - 8;
          window.scrollTo({ top, behavior: 'smooth' });
        });
      }
    }
  } catch (e) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function matchCardHtml(m, cc, logoMap) {
  const pred = m.prediction;
  const h = pred?.home_score ?? '';
  const a = pred?.away_score ?? '';
  const filled = h !== '' && a !== '';
  const homeTeamId = resolveBsdTeamId(m, 'home', logoMap);
  const awayTeamId = resolveBsdTeamId(m, 'away', logoMap);
  const kickoffLabel = formatKickoffLabel(m.kickoff_at);
  const kickoffHtml = kickoffLabel ? `<div class="match-kickoff">${kickoffLabel}</div>` : '';
  const homeName = escapeHtml(m.home_team_name);
  const awayName = escapeHtml(m.away_team_name);

  const isFinished = m.isLocked
    && ['finished', 'FT', 'ended'].includes(m.status)
    && m.home_score !== null && m.away_score !== null;

  if (isFinished) {
    const pts = pred?.points ?? null;
    const ptsColor = pts > 0 ? cc.color : 'var(--ink-soft)';
    const ptsText = pts === null ? '' : (pts === 0 ? '0 pt' : `${pts} pt${pts > 1 ? 's' : ''}`);
    const pronoLine = pred
      ? `<div class="finished-prono">Mon pronostic : ${pred.home_score}–${pred.away_score}${ptsText ? ` · <span style="color:${ptsColor}">${ptsText}</span>` : ''}</div>`
      : `<div class="finished-prono finished-no-prono">Pas de pronostic</div>`;

    return `<div class="match-card match-card-locked match-card-finished" data-match="${m.id}" data-kickoff="${m.kickoff_at}" data-status="${m.status}" data-locked="1" data-home-score="${h}" data-away-score="${a}" data-comp-color="${cc.color}" data-comp-bg="${cc.bg}">
    ${kickoffHtml}
    <div class="match-top">
      <div class="team">${teamCrest(m.home_team_name, m.comp_code, homeTeamId)}<span class="team-name">${homeName}</span></div>
      <div class="score-mid score-finished">
        <div class="finished-result" style="color:${cc.color}">${m.home_score} – ${m.away_score}</div>
        <div class="finished-lbl">Score réel</div>
        ${pronoLine}
      </div>
      <div class="team right"><span class="team-name">${awayName}</span>${teamCrest(m.away_team_name, m.comp_code, awayTeamId)}</div>
    </div>
    <div class="finished-toggle-hint">Voir les pronos du groupe</div>
  </div>`;
  }

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

  const pronosHint = m.isLocked
    ? '<div class="finished-toggle-hint">Voir les pronos du groupe</div>'
    : '';

  return `<div class="match-card${m.isLocked ? ' match-card-locked' : ''}" data-match="${m.id}" data-kickoff="${m.kickoff_at}" data-status="${m.status}" data-locked="${m.isLocked ? '1' : '0'}" data-home-score="${h}" data-away-score="${a}" data-comp-color="${cc.color}" data-comp-bg="${cc.bg}">
    ${kickoffHtml}
    <div class="match-top">
      <div class="team">${teamCrest(m.home_team_name, m.comp_code, homeTeamId)}<span class="team-name">${homeName}</span></div>
      <div class="score-mid">
        <div class="score-pill ${filled ? 'filled' : ''}" style="${filled ? `color:${cc.color};border-color:${cc.color};background:${cc.bg}` : ''}">
          ${m.isLocked ? (h !== '' ? h : '–') : `<input type="number" min="0" max="20" data-side="home" data-match="${m.id}" value="${h}" placeholder="–">`}
        </div>
        <div class="score-pill ${filled ? 'filled' : ''}" style="${filled ? `color:${cc.color};border-color:${cc.color};background:${cc.bg}` : ''}">
          ${m.isLocked ? (a !== '' ? a : '–') : `<input type="number" min="0" max="20" data-side="away" data-match="${m.id}" value="${a}" placeholder="–">`}
        </div>
      </div>
      <div class="team right"><span class="team-name">${awayName}</span>${teamCrest(m.away_team_name, m.comp_code, awayTeamId)}</div>
    </div>
    <div class="match-bottom ${bottomClass}" style="${bottomClass === 'points' ? `color:${cc.color}` : ''}">${bottom}</div>
    ${pronosHint}
  </div>`;
}

function isCardLocked(card) {
  if (card.dataset.locked === '1') return true;
  const kickoff = card.dataset.kickoff;
  if (!kickoff) return false;
  return new Date(kickoff) <= new Date() || LOCKED_STATUSES.has(card.dataset.status ?? '');
}

function lockMatchCard(card, state) {
  if (!isCardLocked(card)) return;

  const matchId = Number(card.dataset.match);
  clearAutoSaveTimer(matchId);
  pendingPredictions.delete(matchId);
  card.dataset.locked = '1';
  card.classList.add('match-card-locked');
  card.classList.remove('match-card-dirty');

  const homeIn = card.querySelector('[data-side="home"]');
  const awayIn = card.querySelector('[data-side="away"]');
  const h = homeIn?.value || card.dataset.homeScore || '';
  const a = awayIn?.value || card.dataset.awayScore || '';
  card.dataset.homeScore = h;
  card.dataset.awayScore = a;

  card.querySelectorAll('.score-pill').forEach((pill, i) => {
    pill.classList.remove('pending');
    const val = i === 0 ? h : a;
    pill.innerHTML = val !== '' ? val : '–';
  });

  const bottom = card.querySelector('.match-bottom');
  if (bottom) {
    bottom.textContent = 'verrouillé';
    bottom.className = 'match-bottom locked-closed';
  }

  ensurePronosHint(card);
  bindPronosToggle(card, state);
}

function ensurePronosHint(card) {
  if (card.querySelector('.finished-toggle-hint')) return;
  const hint = document.createElement('div');
  hint.className = 'finished-toggle-hint';
  hint.textContent = 'Voir les pronos du groupe';
  card.appendChild(hint);
}

function bindPronosToggle(card, state) {
  if (card.dataset.pronosBound === '1') return;
  card.dataset.pronosBound = '1';
  card.addEventListener('click', e => onPronosToggleClick(e, state));
}

function startMatchLockRefresh(state) {
  stopMatchLockRefresh();
  const tick = () => document.querySelectorAll('.match-card[data-kickoff]').forEach(card => lockMatchCard(card, state));
  tick();
  lockRefreshTimer = setInterval(tick, 10000);
}

function stopMatchLockRefresh() {
  if (lockRefreshTimer) clearInterval(lockRefreshTimer);
  lockRefreshTimer = null;
}

function clearAutoSaveTimer(matchId) {
  const timer = autoSaveTimers.get(matchId);
  if (timer) clearTimeout(timer);
  autoSaveTimers.delete(matchId);
}

function onScoreInput(e, state) {
  const matchId = Number(e.target.dataset.match);
  const card = e.target.closest('.match-card');
  if (isCardLocked(card)) return;
  const homeRaw = card.querySelector('[data-side="home"]').value;
  const awayRaw = card.querySelector('[data-side="away"]').value;

  if (homeRaw === '' || awayRaw === '') {
    clearAutoSaveTimer(matchId);
    pendingPredictions.delete(matchId);
    card.classList.remove('match-card-dirty');
    refreshCardScoreStyle(card);
    return;
  }

  pendingPredictions.set(matchId, {
    home: Number(homeRaw),
    away: Number(awayRaw),
  });
  card.classList.add('match-card-dirty');
  refreshCardScoreStyle(card);
  scheduleAutoSave(matchId, card, state);
}

function scheduleAutoSave(matchId, card, state) {
  clearAutoSaveTimer(matchId);
  autoSaveTimers.set(matchId, setTimeout(() => {
    autoSaveTimers.delete(matchId);
    saveMatchPrediction(matchId, card, state, { quiet: true });
  }, 700));
}

async function saveMatchPrediction(matchId, card, state, { quiet = false } = {}) {
  const scores = pendingPredictions.get(matchId);
  if (!scores) return true;

  try {
    await matches.predict(state.group.id, {
      matchId,
      homeScore: scores.home,
      awayScore: scores.away,
    });
    markCardSaved(card, scores);
    if (!quiet) showToast('Pronostic enregistré ✓', 'success');
    advanceToNextPrediction(card);
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    return false;
  }
}

function refreshCardScoreStyle(card) {
  const matchId = Number(card.dataset.match);
  const cc = { color: card.dataset.compColor, bg: card.dataset.compBg };
  const pending = pendingPredictions.get(matchId);
  const hasSaved = card.dataset.homeScore !== '' && card.dataset.awayScore !== '';
  const filled = pending != null || hasSaved;

  card.querySelectorAll('.score-pill').forEach(pill => {
    pill.classList.toggle('filled', filled);
    pill.classList.toggle('pending', pending != null);
    if (filled) {
      pill.style.color = cc.color;
      pill.style.borderColor = cc.color;
      pill.style.background = cc.bg;
    } else {
      pill.style.color = '';
      pill.style.borderColor = '';
      pill.style.background = '';
    }
  });

  const bottom = card.querySelector('.match-bottom');
  if (bottom && bottom.classList.contains('open')) {
    if (pending != null) bottom.textContent = 'enregistrement…';
    else if (hasSaved) bottom.textContent = 'enregistré ✓';
    else bottom.textContent = 'à toi de jouer';
  }
}

function markCardSaved(card, scores = null) {
  const matchId = Number(card.dataset.match);
  const saved = scores ?? pendingPredictions.get(matchId);
  pendingPredictions.delete(matchId);
  card.classList.remove('match-card-dirty');
  if (saved) {
    card.dataset.homeScore = String(saved.home);
    card.dataset.awayScore = String(saved.away);
  }
  refreshCardScoreStyle(card);
  const bottom = card.querySelector('.match-bottom');
  if (bottom?.classList.contains('open')) {
    bottom.textContent = 'enregistré ✓';
    setTimeout(() => {
      if (!pendingPredictions.has(matchId) && bottom.classList.contains('open') && !isCardLocked(card)) {
        bottom.textContent = 'à toi de jouer';
      }
    }, 1800);
  }
}

function advanceToNextPrediction(currentCard) {
  const allCards = [...document.querySelectorAll('.match-card:not(.match-card-locked)')];
  const idx = allCards.indexOf(currentCard);
  if (idx === -1) return;

  for (let i = idx + 1; i < allCards.length; i++) {
    const card = allCards[i];
    const homeInput = card.querySelector('[data-side="home"]');
    const awayInput = card.querySelector('[data-side="away"]');
    if (!homeInput && !awayInput) continue;
    const target = !homeInput?.value ? homeInput : (!awayInput?.value ? awayInput : null);
    if (!target) continue;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => target.focus(), 350);
    return;
  }
}

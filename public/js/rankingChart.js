import { escapeHtml } from './api.js?v=63';

const PALETTE = ['#6B3FD6', '#2D8B57', '#E0532E', '#1C6FD0', '#C9701F', '#0D9488', '#DB2777', '#4F46E5'];
const SLOT = 48;
const YW = 28;
const PLOT_H = 196;
const PAD = { t: 10, b: 30, l: 6, r: 6 };

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function ordinalFr(n) {
  return n === 1 ? '1er' : `${n}e`;
}

function firstName(name) {
  return String(name || '').split(' ')[0];
}

export function participantColor(p, index) {
  return p.profileColor || PALETTE[index % PALETTE.length];
}

function niceTicks(max, count = 4) {
  if (max <= 0) return [0];
  const step = Math.max(1, Math.ceil(max / count));
  const ticks = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return ticks;
}

function rankTicks(max) {
  if (max <= 5) return Array.from({ length: max }, (_, i) => i + 1);
  return [1, Math.round((max + 1) / 2), max];
}

function rankingAt(round, userId) {
  return round.rankings.find(r => Number(r.userId) === Number(userId)) ?? null;
}

function seriesOf(rounds, userId, isRank, nPlayers) {
  return rounds.map(r => {
    const row = rankingAt(r, userId);
    return isRank ? (row?.rank ?? nPlayers) : (row?.cumulativePoints ?? 0);
  });
}

/**
 * Graphe mobile-first : une courbe en avant, tap sur une journée, détail en dessous.
 */
export function mountRankingChart(host, history, { mode = 'position', currentUserId } = {}) {
  const rounds = history?.rounds ?? [];
  const participants = history?.participants ?? [];
  if (!rounds.length || !participants.length) {
    host.innerHTML = '<div class="empty-state">Pas encore de journée terminée</div>';
    return;
  }

  const meId = Number(currentUserId);
  const isRank = mode === 'position';
  const n = rounds.length;
  const innerH = PLOT_H - PAD.t - PAD.b;
  const plotW = Math.max(n * SLOT, 220);
  const xAt = (i) => PAD.l + SLOT / 2 + i * SLOT;

  if (host._evoFocusId === undefined) host._evoFocusId = meId || participants[0].userId;
  if (host._evoRoundIdx == null || host._evoRoundIdx >= n) host._evoRoundIdx = n - 1;
  const focusId = host._evoFocusId == null ? null : Number(host._evoFocusId);
  const roundIdx = host._evoRoundIdx;

  const inkSoft = cssVar('--ink-soft', '#8B85A3');
  const border = cssVar('--border-soft', '#ECE9F6');
  const card = cssVar('--card', '#FFFFFF');
  const accent = cssVar('--pl', '#6B3FD6');

  let yMin;
  let yMax;
  if (isRank) {
    yMin = 1;
    yMax = Math.max(participants.length, 2);
  } else {
    const vals = participants.flatMap(p => seriesOf(rounds, p.userId, false, participants.length));
    yMin = 0;
    yMax = Math.max(...vals, 1);
  }

  const yAt = (v) => {
    const t = (v - yMin) / (yMax - yMin || 1);
    return isRank ? PAD.t + t * innerH : PAD.t + (1 - t) * innerH;
  };

  const yTicks = isRank ? rankTicks(yMax) : niceTicks(yMax, 4);

  const yLabels = yTicks.map(v => (
    `<text x="${YW - 4}" y="${yAt(v) + 3}" text-anchor="end" fill="${inkSoft}" font-size="10" font-weight="700">${v}</text>`
  )).join('');

  const grid = yTicks.map(v => (
    `<line x1="0" y1="${yAt(v)}" x2="${plotW}" y2="${yAt(v)}" stroke="${border}" stroke-dasharray="3 4"/>`
  )).join('');

  const colBandX = xAt(roundIdx) - SLOT / 2;
  const colBand = `<rect class="evo-col-active" x="${colBandX}" y="${PAD.t}" width="${SLOT}" height="${innerH}" fill="${accent}" fill-opacity="0.12" rx="8"/>`;

  const colHits = rounds.map((_, i) => (
    `<rect class="evo-col-hit" data-round="${i}" x="${xAt(i) - SLOT / 2}" y="0" width="${SLOT}" height="${PLOT_H}" fill="transparent"/>`
  )).join('');

  const xLabels = rounds.map((r, i) => {
    const active = i === roundIdx;
    return `<text x="${xAt(i)}" y="${PLOT_H - 10}" text-anchor="middle" fill="${active ? accent : inkSoft}" font-size="11" font-weight="${active ? 800 : 700}">${escapeHtml(r.label)}</text>`;
  }).join('');

  const lineSvg = (p, idx, focused) => {
    const color = participantColor(p, idx);
    const vals = seriesOf(rounds, p.userId, isRank, participants.length);
    const pts = vals.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
    const op = focusId == null || focused ? 1 : 0.18;
    const thick = focused ? 3.4 : 1.8;
    const dots = focused
      ? vals.map((v, i) => {
        const on = i === roundIdx;
        return `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="${on ? 6 : 4}" fill="${color}" stroke="${card}" stroke-width="2" pointer-events="none"/>`;
      }).join('')
      : `<circle cx="${xAt(roundIdx)}" cy="${yAt(vals[roundIdx])}" r="3" fill="${color}" opacity="0.5" pointer-events="none"/>`;
    return `<g opacity="${op}">
      <polyline fill="none" stroke="${color}" stroke-width="${thick}" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>
      ${dots}
    </g>`;
  };

  const pointHits = participants.map((p, idx) => {
    const color = participantColor(p, idx);
    const vals = seriesOf(rounds, p.userId, isRank, participants.length);
    return vals.map((v, i) => {
      const row = rankingAt(rounds[i], p.userId);
      return `<circle class="evo-hit" cx="${xAt(i)}" cy="${yAt(v)}" r="16" fill="transparent"
        data-user="${p.userId}" data-round="${i}"
        data-label="${escapeHtml(rounds[i].label)}"
        data-name="${escapeHtml(p.displayName)}"
        data-rank="${row?.rank ?? ''}"
        data-round-pts="${row?.roundPoints ?? 0}"
        data-cumul="${row?.cumulativePoints ?? 0}"
        data-color="${color}"/>`;
    }).join('');
  }).join('');

  const dimLines = participants
    .map((p, idx) => (Number(p.userId) === focusId ? '' : lineSvg(p, idx, false)))
    .join('');
  const focusP = participants.find(p => Number(p.userId) === focusId);
  const focusIdx = participants.findIndex(p => Number(p.userId) === focusId);
  const focusLine = focusP ? lineSvg(focusP, focusIdx, true) : '';

  const round = rounds[roundIdx];
  const panelRows = [...round.rankings].sort((a, b) => a.rank - b.rank);

  host.innerHTML = `
    <div class="evo-plot-wrap">
      <svg class="evo-y-svg" viewBox="0 0 ${YW} ${PLOT_H}" aria-hidden="true">${yLabels}</svg>
      <div class="evo-scroll">
        <svg class="evo-plot-svg" viewBox="0 0 ${plotW} ${PLOT_H}" width="${plotW}" height="${PLOT_H}" role="img" aria-label="Évolution du classement">
          ${grid}${colBand}${dimLines}${focusLine}${xLabels}${colHits}${pointHits}
        </svg>
      </div>
      <div class="evo-tooltip" hidden>
        <div class="evo-tip-label"></div>
        <div class="evo-tip-name"></div>
        <div class="evo-tip-meta"></div>
      </div>
    </div>
    <div class="evo-legend">
      <button type="button" class="evo-legend-item ${focusId == null ? 'focus' : ''}" data-evo-focus="">Tous</button>
      ${participants.map((p, idx) => {
        const color = participantColor(p, idx);
        const on = Number(p.userId) === focusId;
        const me = Number(p.userId) === meId ? 'me' : '';
        return `<button type="button" class="evo-legend-item ${on ? 'focus' : ''} ${me}" data-evo-focus="${p.userId}">
          <span class="evo-legend-dot" style="background:${color}"></span>
          ${escapeHtml(firstName(p.displayName))}
        </button>`;
      }).join('')}
    </div>
    <div class="evo-round-nav">
      <button type="button" class="evo-nav-btn" data-evo-step="-1" aria-label="Journée précédente" ${roundIdx === 0 ? 'disabled' : ''}>‹</button>
      <div class="evo-round-title">${escapeHtml(round.label)}</div>
      <button type="button" class="evo-nav-btn" data-evo-step="1" aria-label="Journée suivante" ${roundIdx === n - 1 ? 'disabled' : ''}>›</button>
    </div>
    <div class="evo-round-panel">${panelRows.map(r => {
      const p = participants.find(x => Number(x.userId) === Number(r.userId));
      const color = p ? participantColor(p, participants.indexOf(p)) : accent;
      const isMe = Number(r.userId) === meId;
      const isFocus = Number(r.userId) === focusId;
      return `<div class="evo-panel-row ${isMe ? 'me' : ''} ${isFocus ? 'focus' : ''}">
        <span class="evo-panel-rank">${ordinalFr(r.rank)}</span>
        <span class="evo-panel-dot" style="background:${color}"></span>
        <span class="evo-panel-name">${escapeHtml(r.displayName)}</span>
        <span class="evo-panel-delta">+${r.roundPoints}</span>
        <span class="evo-panel-pts">${r.cumulativePoints}<span> pts</span></span>
      </div>`;
    }).join('')}</div>
  `;

  const scroll = host.querySelector('.evo-scroll');
  const activeX = xAt(roundIdx) - SLOT / 2;
  requestAnimationFrame(() => {
    if (scroll) scroll.scrollLeft = Math.max(0, activeX - scroll.clientWidth / 2 + SLOT / 2);
  });

  const goRound = (idx) => {
    host._evoRoundIdx = Math.max(0, Math.min(n - 1, idx));
    mountRankingChart(host, history, { mode, currentUserId });
  };

  const wrap = host.querySelector('.evo-plot-wrap');
  const tip = host.querySelector('.evo-tooltip');
  const tipLabel = tip.querySelector('.evo-tip-label');
  const tipName = tip.querySelector('.evo-tip-name');
  const tipMeta = tip.querySelector('.evo-tip-meta');

  const fillTip = (el) => {
    tipLabel.textContent = el.dataset.label;
    tipName.textContent = el.dataset.name;
    tipName.style.color = el.dataset.color;
    tipMeta.textContent = `${ordinalFr(Number(el.dataset.rank))} · +${el.dataset.roundPts} pts · ${el.dataset.cumul} pts cumulés`;
  };

  const placeTip = (anchor) => {
    const wr = wrap.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(ar.left - wr.left + ar.width / 2, 84), wr.width - 84);
    const top = ar.top - wr.top;
    tip.classList.toggle('below', top < 58);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  const showTip = (el, pin = false) => {
    fillTip(el);
    placeTip(el);
    tip.hidden = false;
    host._evoTipPinned = pin;
  };

  const hideTip = () => {
    if (host._evoTipPinned) return;
    tip.hidden = true;
  };

  host.querySelectorAll('.evo-hit').forEach(el => {
    el.addEventListener('pointerenter', () => showTip(el, false));
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      host._evoTipUserId = Number(el.dataset.user);
      const idx = Number(el.dataset.round);
      if (idx !== roundIdx) {
        host._evoTipPinned = true;
        goRound(idx);
        return;
      }
      showTip(el, true);
    });
  });

  host.querySelectorAll('.evo-col-hit').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.round);
      const uid = host._evoTipUserId ?? focusId ?? meId;
      host._evoTipUserId = uid;
      host._evoTipPinned = true;
      if (idx !== roundIdx) goRound(idx);
      else {
        const hit = host.querySelector(`.evo-hit[data-user="${uid}"][data-round="${idx}"]`);
        if (hit) showTip(hit, true);
      }
    });
  });

  wrap.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch') return;
    host._evoTipPinned = false;
    tip.hidden = true;
  });

  if (host._evoTipPinned && host._evoTipUserId != null) {
    const pinned = host.querySelector(`.evo-hit[data-user="${host._evoTipUserId}"][data-round="${roundIdx}"]`);
    if (pinned) showTip(pinned, true);
  }

  host.querySelectorAll('[data-evo-step]').forEach(btn => {
    btn.onclick = () => goRound(roundIdx + Number(btn.dataset.evoStep));
  });

  host.querySelectorAll('[data-evo-focus]').forEach(btn => {
    btn.onclick = () => {
      const raw = btn.dataset.evoFocus;
      host._evoFocusId = raw === '' ? null : Number(raw);
      mountRankingChart(host, history, { mode, currentUserId });
    };
  });

  host._evoRedraw = () => mountRankingChart(host, history, { mode, currentUserId });
}

if (!window.__matchdayEvoTheme) {
  window.__matchdayEvoTheme = true;
  window.addEventListener('matchday:theme', () => {
    document.querySelectorAll('[data-evo-chart]').forEach(el => el._evoRedraw?.());
  });
}

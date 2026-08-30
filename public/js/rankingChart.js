import { escapeHtml } from './api.js?v=63';

const PALETTE = ['#6B3FD6', '#2D8B57', '#E0532E', '#1C6FD0', '#C9701F', '#0D9488', '#DB2777', '#4F46E5'];

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

function rankingAt(round, userId) {
  return round.rankings.find(r => r.userId === userId) ?? null;
}

/**
 * Graphique SVG (pas de Chart.js — CSP script-src 'self').
 */
export function mountRankingChart(host, history, { mode = 'position', currentUserId } = {}) {
  const rounds = history?.rounds ?? [];
  const participants = history?.participants ?? [];
  if (!rounds.length || !participants.length) {
    host.innerHTML = '<div class="empty-state">Pas encore de journée terminée</div>';
    return;
  }

  if (!(host._evoHidden instanceof Set)) host._evoHidden = new Set();
  const hidden = host._evoHidden;

  const inkSoft = cssVar('--ink-soft', '#8B85A3');
  const border = cssVar('--border-soft', '#ECE9F6');
  const card = cssVar('--card', '#FFFFFF');
  const meId = Number(currentUserId);
  const isRank = mode === 'position';

  const W = 640;
  const H = 248;
  const pad = { l: 40, r: 14, t: 16, b: 40 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = rounds.length;
  const xAt = (i) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);

  const seriesOf = (userId) => rounds.map(r => {
    const row = rankingAt(r, userId);
    return isRank ? (row?.rank ?? participants.length) : (row?.cumulativePoints ?? 0);
  });

  let yMin;
  let yMax;
  if (isRank) {
    yMin = 1;
    yMax = Math.max(participants.length, 2);
  } else {
    const vals = participants.flatMap(p => seriesOf(p.userId));
    yMin = 0;
    yMax = Math.max(...vals, 1);
  }

  const yAt = (v) => {
    const t = (v - yMin) / (yMax - yMin || 1);
    return isRank ? pad.t + t * innerH : pad.t + (1 - t) * innerH;
  };

  const yTicks = isRank
    ? Array.from({ length: yMax }, (_, i) => i + 1)
    : niceTicks(yMax);

  const labelStep = n <= 16 ? 1 : Math.ceil(n / 16);

  const grid = yTicks.map(v => {
    const y = yAt(v);
    return `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="${border}" stroke-dasharray="3 4"/>
      <text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" fill="${inkSoft}" font-size="10" font-weight="700">${v}</text>`;
  }).join('');

  const xLabels = rounds.map((r, i) => {
    if (i % labelStep !== 0 && i !== n - 1) return '';
    return `<text x="${xAt(i)}" y="${H - 12}" text-anchor="middle" fill="${inkSoft}" font-size="9" font-weight="700">${escapeHtml(r.label)}</text>`;
  }).join('');

  const lines = participants.map((p, idx) => {
    if (hidden.has(p.userId)) return '';
    const color = participantColor(p, idx);
    const vals = seriesOf(p.userId);
    const pts = vals.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
    const thick = Number(p.userId) === meId ? 3 : 2.2;
    const dots = vals.map((v, i) => {
      const row = rankingAt(rounds[i], p.userId);
      const attrs = `data-user="${p.userId}" data-round="${i}" data-label="${escapeHtml(rounds[i].label)}" data-name="${escapeHtml(p.displayName)}" data-rank="${row?.rank ?? ''}" data-round-pts="${row?.roundPoints ?? 0}" data-cumul="${row?.cumulativePoints ?? 0}" data-color="${color}"`;
      return `<circle class="evo-hit" cx="${xAt(i)}" cy="${yAt(v)}" r="14" fill="transparent" ${attrs}/>
        <circle class="evo-dot" cx="${xAt(i)}" cy="${yAt(v)}" r="4.5" fill="${color}" stroke="${card}" stroke-width="1.5" pointer-events="none"/>`;
    }).join('');
    return `<polyline fill="none" stroke="${color}" stroke-width="${thick}" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>${dots}`;
  }).join('');

  const yTitle = isRank ? 'Position' : 'Points';

  host.innerHTML = `
    <div class="evo-chart-frame">
      <svg class="evo-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du classement">
        <text x="4" y="12" fill="${inkSoft}" font-size="10" font-weight="800">${yTitle}</text>
        ${grid}
        ${lines}
        ${xLabels}
      </svg>
      <div class="evo-tooltip" hidden>
        <div class="evo-tip-label"></div>
        <div class="evo-tip-name"></div>
        <div class="evo-tip-meta"></div>
      </div>
    </div>
    <div class="evo-legend">${participants.map((p, idx) => {
      const color = participantColor(p, idx);
      const off = hidden.has(p.userId) ? 'off' : '';
      const me = Number(p.userId) === meId ? 'me' : '';
      return `<button type="button" class="evo-legend-item ${off} ${me}" data-evo-legend="${p.userId}">
        <span class="evo-legend-dot" style="background:${color}"></span>
        ${escapeHtml(firstName(p.displayName))}
      </button>`;
    }).join('')}</div>
  `;

  const tip = host.querySelector('.evo-tooltip');
  const tipLabel = tip.querySelector('.evo-tip-label');
  const tipName = tip.querySelector('.evo-tip-name');
  const tipMeta = tip.querySelector('.evo-tip-meta');
  const frame = host.querySelector('.evo-chart-frame');

  host.querySelectorAll('.evo-hit').forEach(dot => {
    const show = () => {
      tip.hidden = false;
      tipLabel.textContent = dot.dataset.label;
      tipName.textContent = dot.dataset.name;
      tipName.style.color = dot.dataset.color;
      tipMeta.textContent = `${ordinalFr(Number(dot.dataset.rank))} · +${dot.dataset.roundPts} pts · ${dot.dataset.cumul} pts cumulés`;
      const rect = frame.getBoundingClientRect();
      const d = dot.getBoundingClientRect();
      const left = d.left - rect.left + d.width / 2;
      tip.style.left = `${Math.min(Math.max(left, 72), rect.width - 72)}px`;
      tip.style.top = `${d.top - rect.top}px`;
    };
    dot.addEventListener('pointerenter', show);
    dot.addEventListener('pointerleave', () => { tip.hidden = true; });
    dot.addEventListener('click', show);
  });

  host.querySelectorAll('[data-evo-legend]').forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.evoLegend);
      if (hidden.has(id)) hidden.delete(id);
      else hidden.add(id);
      if (hidden.size >= participants.length) hidden.clear();
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

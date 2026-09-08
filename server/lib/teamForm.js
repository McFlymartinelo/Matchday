import { normalizeTeamName } from '../services/bsd.js';

const FORM_LIMIT = 5;

export function shortTeamCode(name) {
  const cleaned = String(name ?? '').replace(/['.\-]/g, ' ');
  const words = cleaned.trim().split(/\s+/).filter((w) => /[a-zA-ZÀ-ÿ]/.test(w));
  if (words.length >= 2) {
    const parts = words.map((w) => {
      const letters = w.replace(/[^a-zA-Z]/g, '');
      if (letters.length >= 2 && letters.length <= 3 && letters === letters.toUpperCase()) {
        return letters;
      }
      return letters[0] ?? '';
    });
    const initials = parts.join('').toUpperCase();
    if (initials.length >= 2 && initials.length <= 4) return initials;
  }
  const letters = cleaned.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase();
  return letters || '???';
}

export function formResult(gf, ga) {
  if (gf > ga) return 'V';
  if (gf < ga) return 'D';
  return 'N';
}

export function teamMatchKey(teamId, teamName) {
  const id = Number(teamId);
  return {
    id: Number.isFinite(id) && id > 0 ? id : null,
    name: normalizeTeamName(teamName),
  };
}

export function matchSide(match, team) {
  const homeId = Number(match.home_bsd_team_id);
  const awayId = Number(match.away_bsd_team_id);
  if (team.id != null) {
    if (homeId === team.id) return 'home';
    if (awayId === team.id) return 'away';
  }
  const homeName = normalizeTeamName(match.home_team_name);
  const awayName = normalizeTeamName(match.away_team_name);
  if (team.name && team.name === homeName) return 'home';
  if (team.name && team.name === awayName) return 'away';
  return null;
}

function resolveOppCode(name, teamId, shortNames, codeFn) {
  const id = Number(teamId);
  if (Number.isFinite(id) && shortNames.has(id)) return shortNames.get(id);
  const nkey = normalizeTeamName(name);
  if (shortNames.has(nkey)) return shortNames.get(nkey);
  return codeFn(name);
}

export function formEntry(match, side, shortNames = new Map(), codeFn = shortTeamCode) {
  const isHome = side === 'home';
  const gf = Number(isHome ? match.home_score : match.away_score);
  const ga = Number(isHome ? match.away_score : match.home_score);
  const opponent = isHome ? match.away_team_name : match.home_team_name;
  const oppId = isHome ? match.away_bsd_team_id : match.home_bsd_team_id;
  return {
    matchday: match.matchday ?? null,
    venue: isHome ? 'D' : 'E',
    opponent,
    opp: resolveOppCode(opponent, oppId, shortNames, codeFn),
    opponent_id: Number.isFinite(Number(oppId)) && Number(oppId) > 0 ? Number(oppId) : null,
    gf,
    ga,
    result: formResult(gf, ga),
  };
}

/** `matches` must be newest-first. Returns newest→oldest, max 5. */
export function lastFiveForm(matches, team, shortNames = new Map()) {
  const involved = [];
  for (const match of matches) {
    const side = matchSide(match, team);
    if (!side) continue;
    involved.push(formEntry(match, side, shortNames));
    if (involved.length === FORM_LIMIT) break;
  }
  return involved;
}

export function attachFormToStandings(rows, matches, shortNames = new Map()) {
  return rows.map((row) => ({
    ...row,
    form: lastFiveForm(matches, teamMatchKey(row.team_id, row.team_name), shortNames),
  }));
}

/**
 * Calcule les points d'un pronostic selon le barème configurable.
 */
export function scorePrediction(predHome, predAway, actualHome, actualAway, scoring = {}) {
  const exact = scoring.exact ?? 3;
  const diff = scoring.diff ?? 2;
  const winner = scoring.winner ?? 1;

  if (predHome === actualHome && predAway === actualAway) {
    return { points: exact, detail: 'exact' };
  }

  const predResult = getResult(predHome, predAway);
  const actualResult = getResult(actualHome, actualAway);
  const predDiff = Math.abs(predHome - predAway);
  const actualDiff = Math.abs(actualHome - actualAway);

  if (predResult === actualResult && predDiff === actualDiff) {
    return { points: diff, detail: 'diff' };
  }

  if (predResult === actualResult) {
    return { points: winner, detail: 'winner' };
  }

  return { points: 0, detail: 'miss' };
}

function getResult(home, away) {
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'draw';
}

/**
 * Vérifie la règle max 1 joueur par club pour le Mon 11.
 */
export function validateSeasonXiPlayers(players) {
  if (players.length > 11) {
    return { valid: false, error: 'Maximum 11 joueurs' };
  }

  const hasGoalkeeper = players.some(p => p.position === 'GK');
  if (players.length === 11 && !hasGoalkeeper) {
    return { valid: false, error: 'Un gardien est obligatoire' };
  }

  const teamIds = players.map(p => p.team_id);
  const uniqueTeams = new Set(teamIds);
  if (uniqueTeams.size !== teamIds.length) {
    const dup = teamIds.find((id, i) => teamIds.indexOf(id) !== i);
    const team = players.find(p => p.team_id === dup);
    return { valid: false, error: `Un seul joueur par club (${team?.team_name ?? 'club'})` };
  }

  return { valid: true };
}

/**
 * Calcule l'équipe type de la journée à partir des stats joueurs BSD.
 * Formation par défaut : 1-4-3-3
 */
export function computeMatchdayXi(playerStats, formation = { GK: 1, DEF: 4, MID: 3, FWD: 3 }) {
  const eligible = playerStats.filter(p => (p.minutes ?? 0) >= 45 || p.played === true);

  const byPosition = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of eligible) {
    const pos = normalizePosition(p.position);
    if (byPosition[pos]) byPosition[pos].push(p);
  }

  const xi = [];
  for (const [pos, count] of Object.entries(formation)) {
    const sorted = byPosition[pos].sort(comparePlayers);
    xi.push(...sorted.slice(0, count));
  }
  return xi;
}

function normalizePosition(pos) {
  const map = {
    G: 'GK', GK: 'GK', Goalkeeper: 'GK',
    D: 'DEF', DEF: 'DEF', Defender: 'DEF',
    M: 'MID', MID: 'MID', Midfielder: 'MID',
    F: 'FWD', FWD: 'FWD', Forward: 'FWD', Attacker: 'FWD',
  };
  return map[pos] ?? pos;
}

function comparePlayers(a, b) {
  const ratingA = a.rating ?? 0;
  const ratingB = b.rating ?? 0;
  if (ratingB !== ratingA) return ratingB - ratingA;
  const gaA = (a.goals ?? 0) + (a.assists ?? 0);
  const gaB = (b.goals ?? 0) + (b.assists ?? 0);
  return gaB - gaA;
}

/**
 * Calcule les points bonus Mon 11 pour un membre.
 */
export function computeSeasonXiBonus(memberPlayerIds, matchdayXiPlayerIds) {
  const xiSet = new Set(matchdayXiPlayerIds);
  const matching = memberPlayerIds.filter(id => xiSet.has(id));
  return { points: matching.length, matchingPlayerIds: matching };
}

/**
 * Points des paris spéciaux de saison.
 */
export function scoreSpecialBet(betType, betValue, actualValue) {
  const normalized = String(betValue).trim().toLowerCase();
  const actual = String(actualValue).trim().toLowerCase();
  if (normalized !== actual) return 0;

  switch (betType) {
    case 'champion': return 5;
    case 'top_scorer': return 3;
    case 'champions_league':
    case 'relegation': return 1;
    default: return 0;
  }
}

/**
 * Filtre les matchs par championnats du groupe (logique serveur).
 */
export function filterMatchesByGroupCompetitions(matches, groupCompetitionIds) {
  const allowed = new Set(groupCompetitionIds);
  return matches.filter(m => allowed.has(m.competition_id));
}

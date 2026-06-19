import { all, run } from '../db/connection.js';
import { scoreSpecialBet } from './scoring.js';

function normName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Met à jour les points des paris « champion » selon le leader actuel du classement officiel. */
export async function scoreChampionBetsForCompetition(competitionId, season = '2025-2026') {
  const leader = await all(
    `SELECT team_name FROM official_standings
     WHERE competition_id = ? AND season = ? ORDER BY position ASC LIMIT 1`,
    [competitionId, season]
  );
  if (!leader.length) return 0;

  const winner = leader[0].team_name;
  const bets = await all(
    `SELECT id, bet_value FROM special_bets
     WHERE competition_id = ? AND season = ? AND bet_type = 'champion'`,
    [competitionId, season]
  );

  let updated = 0;
  for (const bet of bets) {
    const pts = teamsMatch(bet.bet_value, winner)
      ? scoreSpecialBet('champion', bet.bet_value, winner)
      : 0;
    await run('UPDATE special_bets SET points = ? WHERE id = ?', [pts, bet.id]);
    updated++;
  }
  return updated;
}

function teamsMatch(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aWords = na.split(' ');
  const bWords = nb.split(' ');
  return aWords.some(w => w.length > 3 && bWords.includes(w));
}

export { normName };

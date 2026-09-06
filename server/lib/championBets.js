import { all, get, run } from '../db/connection.js';
import { scoreSpecialBet } from './scoring.js';
import { isCompetitionSeasonFinished } from './season.js';
import { isCupCompetition } from './competitions.js';

function normName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Vainqueur officiel : 1er du classement, ou vainqueur de la finale pour une coupe. */
export async function resolveCompetitionWinner(competitionId, season) {
  const comp = await get('SELECT code FROM competitions WHERE id = ?', [competitionId]);
  if (isCupCompetition(comp?.code)) {
    const final = await get(
      `SELECT home_team_name, away_team_name, home_score, away_score
       FROM matches
       WHERE competition_id = ? AND season = ?
         AND status IN ('finished', 'FT', 'ended')
         AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY datetime(kickoff_at) DESC, id DESC
       LIMIT 1`,
      [competitionId, season]
    );
    if (!final) return null;
    const hs = Number(final.home_score);
    const as = Number(final.away_score);
    if (hs === as) return null;
    return hs > as ? final.home_team_name : final.away_team_name;
  }

  const leader = await get(
    `SELECT team_name FROM official_standings
     WHERE competition_id = ? AND season = ? ORDER BY position ASC LIMIT 1`,
    [competitionId, season]
  );
  return leader?.team_name ?? null;
}

/** Met à jour les points des paris « champion » quand la saison est terminée. */
export async function scoreChampionBetsForCompetition(competitionId, season = '2025-2026') {
  if (!await isCompetitionSeasonFinished(competitionId, season)) {
    const bets = await all(
      `SELECT id FROM special_bets
       WHERE competition_id = ? AND season = ? AND bet_type = 'champion'`,
      [competitionId, season]
    );
    for (const bet of bets) {
      await run('UPDATE special_bets SET points = 0 WHERE id = ?', [bet.id]);
    }
    return bets.length;
  }

  const winner = await resolveCompetitionWinner(competitionId, season);
  if (!winner) return 0;
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

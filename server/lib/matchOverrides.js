import { all, run } from '../db/connection.js';
import { normalizeTeamName } from '../services/bsd.js';

const J1_WINDOW_START = Date.parse('2026-08-22T00:00:00Z');
const J1_WINDOW_END = Date.parse('2026-08-25T00:00:00Z');

function isPsg(name) {
  const n = normalizeTeamName(name);
  return n === 'psg' || n.includes('paris sg') || n.includes('paris saint germain');
}

function isRennes(name) {
  const n = normalizeTeamName(name);
  return n.includes('rennes') || n.includes('rennais');
}

function isJ1Kickoff(match) {
  if (Number(match.matchday) === 1) return true;
  const t = Date.parse(match.kickoff_at ?? '');
  return !Number.isNaN(t) && t >= J1_WINDOW_START && t < J1_WINDOW_END;
}

/** J1 Ligue 1 2026-27 : PSG–Rennes délocalisé au Roazhon Park (inversion domicile). */
export function shouldInvertPsgRennes(match) {
  return isPsg(match.home_team_name) && isRennes(match.away_team_name) && isJ1Kickoff(match);
}

export function applyVenueOverride(match) {
  if (!shouldInvertPsgRennes(match)) return match;
  return {
    ...match,
    home_team_name: match.away_team_name,
    away_team_name: match.home_team_name,
    home_bsd_team_id: match.away_bsd_team_id ?? null,
    away_bsd_team_id: match.home_bsd_team_id ?? null,
    home_team_id: match.away_team_id ?? null,
    away_team_id: match.home_team_id ?? null,
    home_score: match.away_score ?? null,
    away_score: match.home_score ?? null,
  };
}

/** Inverse en base le J1 PSG–Rennes et permute les pronostics déjà saisis. */
export async function invertPersistedVenueOverrides() {
  const rows = await all(
    `SELECT * FROM matches
     WHERE (lower(away_team_name) LIKE '%rennes%' OR lower(away_team_name) LIKE '%rennais%')
       AND (lower(home_team_name) LIKE '%paris%' OR lower(home_team_name) LIKE '%psg%')`
  );

  let inverted = 0;
  for (const row of rows) {
    if (!shouldInvertPsgRennes(row)) continue;

    await run(
      `UPDATE matches SET
         home_team_name = away_team_name,
         away_team_name = home_team_name,
         home_bsd_team_id = away_bsd_team_id,
         away_bsd_team_id = home_bsd_team_id,
         home_team_id = away_team_id,
         away_team_id = home_team_id,
         home_score = away_score,
         away_score = home_score,
         updated_at = datetime('now')
       WHERE id = ?`,
      [row.id]
    );
    await run(
      `UPDATE predictions SET
         home_score = away_score,
         away_score = home_score,
         updated_at = datetime('now')
       WHERE match_id = ?`,
      [row.id]
    );
    inverted++;
  }

  return inverted;
}

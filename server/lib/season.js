import { all, get } from '../db/connection.js';

export async function getCompetitionSeason(competitionId) {
  const row = await get('SELECT saison_active FROM competitions WHERE id = ?', [competitionId]);
  return row?.saison_active ?? '2025-2026';
}

export async function getGroupPrimarySeason(groupId) {
  const rows = await all(
    `SELECT c.saison_active FROM competitions c
     JOIN group_competitions gc ON gc.competition_id = c.id
     WHERE gc.group_id = ?`,
    [groupId]
  );
  if (!rows.length) return '2025-2026';
  return rows.map(r => r.saison_active).filter(Boolean).sort().pop() ?? '2025-2026';
}

/** True dès qu'au moins un match de la saison a commencé (coup d'envoi passé ou terminé). */
export async function isCompetitionSeasonStarted(competitionId, season) {
  const row = await get(
    `SELECT 1 AS ok FROM matches
     WHERE competition_id = ? AND season = ?
       AND (
         datetime(kickoff_at) <= datetime('now')
         OR status IN ('live', 'inprogress', 'finished', 'FT', 'ended')
       )
     LIMIT 1`,
    [competitionId, season]
  );
  return !!row;
}

/** True quand tous les matchs de la saison sont terminés. */
export async function isCompetitionSeasonFinished(competitionId, season) {
  const row = await get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status IN ('finished', 'FT', 'ended') THEN 1 ELSE 0 END) AS done
     FROM matches
     WHERE competition_id = ? AND season = ?`,
    [competitionId, season]
  );
  const total = Number(row?.total ?? 0);
  const done = Number(row?.done ?? 0);
  return total > 0 && done === total;
}

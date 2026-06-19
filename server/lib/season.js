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

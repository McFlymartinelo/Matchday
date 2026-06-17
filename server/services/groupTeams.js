import { all } from '../db/connection.js';
import * as bsd from './bsd.js';

const teamMapCache = new Map();

export async function getGroupTeamMap(groupId) {
  const cached = teamMapCache.get(groupId);
  if (cached && Date.now() - cached.at < 3600000) return cached.map;

  const comps = await all(
    `SELECT c.id, c.code, c.bsd_league_id, c.nom FROM competitions c
     JOIN group_competitions gc ON gc.competition_id = c.id
     WHERE gc.group_id = ? AND c.bsd_league_id IS NOT NULL`,
    [groupId]
  );

  const map = new Map();
  for (const c of comps) {
    try {
      const data = await bsd.getTeams({ league_id: c.bsd_league_id, limit: 200 });
      for (const t of bsd.extractResults(data)) {
        map.set(t.id, {
          team_id: t.id,
          team_name: t.name ?? t.short_name,
          short_name: t.short_name ?? (t.name || '').split(' ').pop(),
          competition_id: c.id,
          comp_code: c.code,
          comp_nom: c.nom,
          logo_url: `https://sports.bzzoiro.com/img/team/${t.id}/?bg=transparent`,
        });
      }
    } catch {
      // Ligue indisponible
    }
  }

  teamMapCache.set(groupId, { at: Date.now(), map });
  return map;
}

export async function getGroupTeamsList(groupId) {
  const map = await getGroupTeamMap(groupId);
  return [...map.values()].sort((a, b) => {
    const comp = a.comp_nom.localeCompare(b.comp_nom, 'fr');
    if (comp !== 0) return comp;
    return a.team_name.localeCompare(b.team_name, 'fr');
  });
}

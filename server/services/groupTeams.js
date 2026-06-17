import { all } from '../db/connection.js';
import * as bsd from './bsd.js';

const teamMapCache = new Map();
const CACHE_MS = 3600000;

async function loadShortNames(leagueId) {
  const shortNames = new Map();
  try {
    const data = await bsd.getTeams({ league_id: leagueId, limit: 200 });
    for (const t of bsd.extractResults(data)) {
      shortNames.set(t.id, t.short_name ?? (t.name || '').split(' ').pop());
    }
  } catch {
    /* optionnel */
  }
  return shortNames;
}

export async function getGroupTeamMap(groupId) {
  const cacheKey = `${groupId}:v2`;
  const cached = teamMapCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.map;

  const comps = await all(
    `SELECT c.id, c.code, c.bsd_league_id, c.nom FROM competitions c
     JOIN group_competitions gc ON gc.competition_id = c.id
     WHERE gc.group_id = ? AND c.bsd_league_id IS NOT NULL`,
    [groupId]
  );

  const map = new Map();
  for (const c of comps) {
    try {
      const standingTeams = await bsd.getStandingTeams(c.bsd_league_id);
      if (!standingTeams?.length) continue;

      const shortNames = await loadShortNames(c.bsd_league_id);

      for (const t of standingTeams) {
        map.set(t.team_id, {
          team_id: t.team_id,
          team_name: t.team_name,
          short_name: shortNames.get(t.team_id) ?? t.team_name.split(' ').pop(),
          competition_id: c.id,
          comp_code: c.code,
          comp_nom: c.nom,
          logo_url: `https://sports.bzzoiro.com/img/team/${t.team_id}/?bg=transparent`,
        });
      }
    } catch {
      // Ligue indisponible
    }
  }

  teamMapCache.set(cacheKey, { at: Date.now(), map });
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

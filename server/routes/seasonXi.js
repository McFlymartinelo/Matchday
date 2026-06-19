import { Router } from 'express';
import { all, get, run } from '../db/connection.js';
import { authRequired, groupMemberRequired } from '../middleware/auth.js';
import { validateSeasonXiPlayers } from '../lib/scoring.js';
import { getGroupTeamMap } from '../services/groupTeams.js';
import * as bsd from '../services/bsd.js';

const router = Router();

async function getGroupTeamMapCached(groupId) {
  return getGroupTeamMap(groupId);
}

function mapPlayerForGroup(player, teamMap) {
  const teamId = player.current_team_id ?? player.team_id;
  const teamInfo = teamMap.get(teamId);
  if (!teamInfo) return null;
  return bsd.normalizePlayerListItem(player, teamInfo);
}

router.get('/:groupId/season-xi', authRequired, groupMemberRequired, async (req, res) => {
  const season = req.query.season ?? '2025-2026';
  const userId = req.query.userId ? Number(req.query.userId) : req.user.id;

  const xi = await get(
    'SELECT * FROM season_xi WHERE user_id = ? AND group_id = ? AND season = ?',
    [userId, req.groupId, season]
  );

  let players = [];
  if (xi) {
    players = await all(
      `SELECT sxp.*, c.code as comp_code, c.nom as comp_nom, c.couleur, c.couleur_bg
       FROM season_xi_players sxp
       JOIN competitions c ON c.id = sxp.competition_id WHERE sxp.season_xi_id = ?`,
      [xi.id]
    );
  }

  const bonusTotal = await get(
    'SELECT COALESCE(SUM(points), 0) as total FROM season_xi_points WHERE user_id = ? AND group_id = ? AND season = ?',
    [userId, req.groupId, season]
  );

  const group = await get('SELECT season_xi_deadline FROM groups WHERE id = ?', [req.groupId]);

  res.json({
    seasonXi: xi,
    players,
    formation: xi?.formation ?? '433',
    bonusTotal: bonusTotal?.total ?? 0,
    deadline: group?.season_xi_deadline,
    isLocked: !!xi?.locked_at || (group?.season_xi_deadline && new Date(group.season_xi_deadline) <= new Date()),
  });
});

router.put('/:groupId/season-xi', authRequired, groupMemberRequired, async (req, res) => {
  const { players, formation = '433', season = '2025-2026' } = req.body;
  const group = await get('SELECT season_xi_deadline FROM groups WHERE id = ?', [req.groupId]);

  if (group?.season_xi_deadline && new Date(group.season_xi_deadline) <= new Date()) {
    return res.status(400).json({ error: 'Date limite dépassée — composition verrouillée' });
  }

  const normalized = (players ?? []).map(p => ({
    ...p,
    position: bsd.normalizeXiPosition(p.position),
    slot_id: p.slot_id ?? p.slotId ?? null,
  }));

  const validation = validateSeasonXiPlayers(normalized);
  if (!validation.valid) return res.status(400).json({ error: validation.error });

  const compIds = (await all('SELECT competition_id FROM group_competitions WHERE group_id = ?', [req.groupId]))
    .map(r => r.competition_id);

  for (const p of normalized) {
    if (!compIds.includes(p.competition_id)) {
      return res.status(400).json({ error: 'Joueur hors championnats du groupe' });
    }
    if (!p.team_id || !p.player_id) {
      return res.status(400).json({ error: 'Données joueur incomplètes' });
    }
  }

  let xi = await get(
    'SELECT * FROM season_xi WHERE user_id = ? AND group_id = ? AND season = ?',
    [req.user.id, req.groupId, season]
  );

  if (xi?.locked_at) return res.status(400).json({ error: 'Composition déjà verrouillée' });

  if (!xi) {
    const result = await run(
      'INSERT INTO season_xi (user_id, group_id, season, formation) VALUES (?, ?, ?, ?)',
      [req.user.id, req.groupId, season, formation]
    );
    xi = { id: Number(result.lastInsertRowid) };
  } else {
    await run('UPDATE season_xi SET formation = ? WHERE id = ?', [formation, xi.id]);
  }

  await run('DELETE FROM season_xi_players WHERE season_xi_id = ?', [xi.id]);
  for (const p of normalized) {
    await run(
      `INSERT INTO season_xi_players (season_xi_id, player_id, player_name, team_id, team_name, competition_id, position, slot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [xi.id, p.player_id, p.player_name, p.team_id, p.team_name, p.competition_id, p.position, p.slot_id]
    );
  }

  res.json({ ok: true, playerCount: normalized.length });
});

router.get('/:groupId/season-xi/search', authRequired, groupMemberRequired, async (req, res) => {
  const { q, competitionId } = req.query;
  if (!q || q.length < 2) return res.json([]);

  try {
    const teamMap = await getGroupTeamMapCached(req.groupId);
    const data = await bsd.searchPlayers({ name: q, limit: 80 });
    const raw = bsd.extractResults(data);

    let mapped = raw
      .map(p => mapPlayerForGroup(p, teamMap))
      .filter(Boolean);

    if (competitionId) {
      mapped = mapped.filter(p => p.competition_id === Number(competitionId));
    }

    res.json(mapped.slice(0, 40));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/** Joueurs disponibles — tous les championnats du groupe, ou un seul si competitionId fourni */
router.get('/:groupId/season-xi/browse', authRequired, groupMemberRequired, async (req, res) => {
  const competitionId = req.query.competitionId ? Number(req.query.competitionId) : null;
  const { q } = req.query;

  try {
    const teamMap = await getGroupTeamMapCached(req.groupId);
    let teams = [...teamMap.values()];

    if (competitionId) {
      teams = teams.filter(t => t.competition_id === competitionId);
    } else {
      // Échantillon équilibré : quelques clubs par championnat du groupe
      const byComp = new Map();
      for (const t of teams) {
        if (!byComp.has(t.competition_id)) byComp.set(t.competition_id, []);
        byComp.get(t.competition_id).push(t);
      }
      teams = [];
      for (const compTeams of byComp.values()) {
        teams.push(...compTeams.slice(0, 4));
      }
    }

    if (q && q.length >= 2) {
      const data = await bsd.searchPlayers({ name: q, limit: 80 });
      let results = bsd.extractResults(data)
        .map(p => mapPlayerForGroup(p, teamMap))
        .filter(Boolean);
      if (competitionId) {
        results = results.filter(p => p.competition_id === competitionId);
      }
      results.sort((a, b) => a.player_name.localeCompare(b.player_name, 'fr'));
      return res.json(results.slice(0, 40));
    }

    const players = [];
    const batchSize = 4;
    for (let i = 0; i < teams.length; i += batchSize) {
      const batch = teams.slice(i, i + batchSize);
      const squads = await Promise.all(batch.map(async (team) => {
        try {
          const squad = await bsd.getTeamSquad(team.team_id);
          const rows = squad.players ?? squad.squad ?? bsd.extractResults(squad);
          return rows.map(p => bsd.normalizePlayerListItem(
            { ...p, current_team_id: team.team_id },
            team
          ));
        } catch {
          return [];
        }
      }));
      for (const rows of squads) players.push(...rows);
      if (players.length >= 120) break;
    }

    players.sort((a, b) => a.player_name.localeCompare(b.player_name, 'fr'));
    res.json(players.slice(0, 120));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/:groupId/season-xi/matchday-xi/:competitionId/:matchday', authRequired, groupMemberRequired, async (req, res) => {
  const rows = await all(
    'SELECT * FROM matchday_xi WHERE competition_id = ? AND season = ? AND matchday = ? ORDER BY position',
    [req.params.competitionId, req.query.season ?? '2025-2026', req.params.matchday]
  );
  res.json(rows);
});

export default router;

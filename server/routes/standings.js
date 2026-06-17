import { Router } from 'express';
import { all, get, run } from '../db/connection.js';
import { authRequired, groupMemberRequired } from '../middleware/auth.js';

const router = Router();

router.get('/:groupId/standings', authRequired, groupMemberRequired, async (req, res) => {
  const { competitionId } = req.query;
  const compIds = (await all('SELECT competition_id FROM group_competitions WHERE group_id = ?', [req.groupId]))
    .map(r => r.competition_id);

  let matchFilter = '';
  const baseParams = [req.groupId, req.groupId];
  if (competitionId) {
    matchFilter = ' AND m.competition_id = ?';
    baseParams.push(Number(competitionId));
  } else if (compIds.length) {
    matchFilter = ` AND m.competition_id IN (${compIds.map(() => '?').join(',')})`;
    baseParams.push(...compIds);
  }

  const rows = await all(
    `SELECT u.id, u.display_name, u.avatar, u.profile_color,
            COALESCE(SUM(p.points), 0) as pred_points,
            COALESCE(SUM(CASE WHEN p.points_detail = 'exact' THEN 1 ELSE 0 END), 0) as exact_count,
            COALESCE(SUM(CASE WHEN p.points_detail = 'diff' THEN 1 ELSE 0 END), 0) as diff_count,
            COALESCE(SUM(CASE WHEN p.points_detail = 'winner' THEN 1 ELSE 0 END), 0) as winner_count
     FROM users u
     JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ?
     LEFT JOIN predictions p ON p.user_id = u.id AND p.group_id = ?
     LEFT JOIN matches m ON m.id = p.match_id ${matchFilter}
     GROUP BY u.id
     ORDER BY pred_points DESC`,
    baseParams
  );

  const bonusRows = await all(
    `SELECT user_id, COALESCE(SUM(points), 0) as xi_points FROM season_xi_points
     WHERE group_id = ? ${competitionId ? 'AND competition_id = ?' : ''} GROUP BY user_id`,
    competitionId ? [req.groupId, Number(competitionId)] : [req.groupId]
  );
  const bonusMap = Object.fromEntries(bonusRows.map(b => [b.user_id, b.xi_points]));

  res.json(rows.map((r, i) => ({
    rank: i + 1,
    userId: r.id,
    displayName: r.display_name,
    avatar: r.avatar,
    profileColor: r.profile_color,
    predPoints: r.pred_points,
    xiPoints: bonusMap[r.id] ?? 0,
    totalPoints: r.pred_points + (bonusMap[r.id] ?? 0),
    exactCount: r.exact_count,
    diffCount: r.diff_count,
    winnerCount: r.winner_count,
  })));
});

router.get('/:groupId/standings/matchday/:matchday', authRequired, groupMemberRequired, async (req, res) => {
  const { competitionId } = req.query;
  const matchday = Number(req.params.matchday);

  let sql = `SELECT u.id, u.display_name, u.avatar, COALESCE(SUM(p.points), 0) as points
             FROM users u
             JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ?
             LEFT JOIN predictions p ON p.user_id = u.id AND p.group_id = ?
             LEFT JOIN matches m ON m.id = p.match_id AND m.matchday = ?`;
  const params = [req.groupId, req.groupId, matchday];
  if (competitionId) { sql += ' AND m.competition_id = ?'; params.push(Number(competitionId)); }
  sql += ' GROUP BY u.id ORDER BY points DESC';

  const rows = await all(sql, params);
  res.json(rows.map((r, i) => ({ rank: i + 1, ...r })));
});

router.get('/:groupId/standings/official/:competitionId', authRequired, groupMemberRequired, async (req, res) => {
  const compId = Number(req.params.competitionId);
  const member = await get(
    'SELECT 1 FROM group_competitions WHERE group_id = ? AND competition_id = ?',
    [req.groupId, compId]
  );
  if (!member) return res.status(403).json({ error: 'Championnat non suivi par ce groupe' });

  const rows = await all(
    'SELECT * FROM official_standings WHERE competition_id = ? AND season = ? ORDER BY position',
    [compId, '2025-2026']
  );
  res.json(rows);
});

/** Classements officiels de tous les championnats du groupe */
router.get('/:groupId/standings/official', authRequired, groupMemberRequired, async (req, res) => {
  const comps = await all(
    `SELECT c.* FROM competitions c
     JOIN group_competitions gc ON gc.competition_id = c.id
     WHERE gc.group_id = ?
     ORDER BY c.nom`,
    [req.groupId]
  );

  const result = [];
  for (const c of comps) {
    const rows = await all(
      'SELECT position, team_name, played, won, drawn, lost, goals_for, goals_against, points, updated_at FROM official_standings WHERE competition_id = ? AND season = ? ORDER BY position',
      [c.id, '2025-2026']
    );
    result.push({
      competition: {
        id: c.id, code: c.code, nom: c.nom, emoji: c.emoji,
        couleur: c.couleur, couleurBg: c.couleur_bg,
      },
      rows,
    });
  }
  res.json(result);
});

router.get('/:groupId/stats', authRequired, groupMemberRequired, async (req, res) => {
  const userId = req.query.userId ? Number(req.query.userId) : req.user.id;

  const timeline = await all(
    `SELECT m.matchday, m.competition_id, SUM(p.points) as points, m.kickoff_at
     FROM predictions p JOIN matches m ON m.id = p.match_id
     WHERE p.user_id = ? AND p.group_id = ? AND p.points IS NOT NULL
     GROUP BY m.matchday, m.competition_id ORDER BY m.kickoff_at`,
    [userId, req.groupId]
  );

  const xiTimeline = await all(
    `SELECT matchday, competition_id, points FROM season_xi_points
     WHERE user_id = ? AND group_id = ? ORDER BY matchday`,
    [userId, req.groupId]
  );

  res.json({ timeline, xiTimeline });
});

/** Bilan complet pour l'écran Profil */
router.get('/:groupId/profile', authRequired, groupMemberRequired, async (req, res) => {
  const userId = req.user.id;
  const compIds = (await all('SELECT competition_id FROM group_competitions WHERE group_id = ?', [req.groupId]))
    .map(r => r.competition_id);

  const memberCount = (await get(
    'SELECT COUNT(*) as n FROM group_members WHERE group_id = ?', [req.groupId]
  ))?.n ?? 0;

  const compFilter = compIds.length
    ? ` AND m.competition_id IN (${compIds.map(() => '?').join(',')})`
    : '';
  const compParams = [...compIds];

  const predStats = await get(
    `SELECT
       COALESCE(SUM(p.points), 0) as pred_points,
       COALESCE(SUM(CASE WHEN p.points_detail = 'exact' THEN 1 ELSE 0 END), 0) as exact_count,
       COALESCE(SUM(CASE WHEN p.points_detail = 'diff' THEN 1 ELSE 0 END), 0) as diff_count,
       COALESCE(SUM(CASE WHEN p.points_detail = 'winner' THEN 1 ELSE 0 END), 0) as winner_count,
       COALESCE(SUM(CASE WHEN p.points_detail = 'miss' THEN 1 ELSE 0 END), 0) as miss_count,
       COUNT(CASE WHEN p.points IS NOT NULL THEN 1 END) as scored_count
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     WHERE p.user_id = ? AND p.group_id = ?
       AND m.status IN ('finished', 'FT', 'ended') ${compFilter}`,
    [userId, req.groupId, ...compParams]
  );

  const finishedMatches = (await get(
    `SELECT COUNT(DISTINCT m.id) as n FROM matches m
     WHERE m.status IN ('finished', 'FT', 'ended')${compFilter}`,
    compParams
  ))?.n ?? 0;

  const xiPoints = (await get(
    'SELECT COALESCE(SUM(points), 0) as n FROM season_xi_points WHERE user_id = ? AND group_id = ?',
    [userId, req.groupId]
  ))?.n ?? 0;

  // Classement général du groupe
  const allRows = await all(
    `SELECT u.id,
            COALESCE(SUM(p.points), 0) + COALESCE(xi.xi_pts, 0) as total
     FROM users u
     JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ?
     LEFT JOIN predictions p ON p.user_id = u.id AND p.group_id = ?
     LEFT JOIN matches m ON m.id = p.match_id ${compFilter}
     LEFT JOIN (
       SELECT user_id, SUM(points) as xi_pts FROM season_xi_points WHERE group_id = ? GROUP BY user_id
     ) xi ON xi.user_id = u.id
     GROUP BY u.id
     ORDER BY total DESC`,
    [req.groupId, req.groupId, ...compParams, req.groupId]
  );

  const rank = allRows.findIndex(r => Number(r.id) === Number(userId)) + 1;
  const predPoints = Number(predStats?.pred_points ?? 0);
  const totalPoints = predPoints + Number(xiPoints);
  const scoredCount = Number(predStats?.scored_count ?? 0);
  const exactCount = Number(predStats?.exact_count ?? 0);
  const diffCount = Number(predStats?.diff_count ?? 0);
  const winnerCount = Number(predStats?.winner_count ?? 0);
  const missCount = Number(predStats?.miss_count ?? 0);
  const precision = scoredCount > 0
    ? Math.round(((exactCount + diffCount + winnerCount) / scoredCount) * 100)
    : 0;
  const avgPerMatch = scoredCount > 0 ? (predPoints / scoredCount).toFixed(2) : '0.00';

  res.json({
    rank: rank || memberCount,
    memberCount: Number(memberCount),
    predPoints,
    xiPoints: Number(xiPoints),
    totalPoints,
    exactCount,
    diffCount,
    winnerCount,
    missCount,
    scoredCount,
    finishedMatches: Number(finishedMatches),
    precision,
    avgPerMatch,
  });
});

export default router;

import { Router } from 'express';
import { all, get, run } from '../db/connection.js';
import { authRequired, groupMemberRequired } from '../middleware/auth.js';
import { getCompetitionSeason } from '../lib/season.js';
import { applyZonesToRows, defaultEuropeanZones } from '../lib/standingZones.js';
import { withRanks } from '../lib/scoring.js';
import { buildRankingHistory, accumulateHistory, buildPointsByRound } from '../lib/rankingHistory.js';

const router = Router();

const ACTIVE_SEASON_MATCH = `m.season = (SELECT saison_active FROM competitions WHERE id = m.competition_id)`;
const ACTIVE_SEASON_SPECIAL = `sb.season = (SELECT saison_active FROM competitions WHERE id = sb.competition_id)`;
const ACTIVE_SEASON_XI = `sx.season = (SELECT saison_active FROM competitions WHERE id = sx.competition_id)`;
const FINISHED_STATUSES = `('finished', 'FT', 'ended')`;

function buildMatchFilter(competitionId, compIds) {
  if (competitionId) {
    return { sql: ' AND m.competition_id = ?', params: [Number(competitionId)] };
  }
  if (compIds.length) {
    return {
      sql: ` AND m.competition_id IN (${compIds.map(() => '?').join(',')})`,
      params: [...compIds],
    };
  }
  return { sql: '', params: [] };
}

/** Pronos notés : saison active du championnat + match terminé uniquement. */
function scoredPredictionsJoin(matchFilterSql, groupId) {
  return `
    LEFT JOIN (
      SELECT p.user_id,
             COALESCE(SUM(p.points), 0) AS pred_points,
             COALESCE(SUM(CASE WHEN p.points_detail = 'exact' THEN 1 END), 0) AS exact_count,
             COALESCE(SUM(CASE WHEN p.points_detail = 'diff' THEN 1 END), 0) AS diff_count,
             COALESCE(SUM(CASE WHEN p.points_detail = 'winner' THEN 1 END), 0) AS winner_count,
             COALESCE(SUM(CASE WHEN p.points_detail = 'miss' THEN 1 END), 0) AS miss_count,
             COUNT(CASE WHEN p.points IS NOT NULL THEN 1 END) AS scored_count
      FROM predictions p
      INNER JOIN matches m ON m.id = p.match_id
        AND ${ACTIVE_SEASON_MATCH}
        AND m.status IN ${FINISHED_STATUSES}
        ${matchFilterSql}
      WHERE p.group_id = ?
      GROUP BY p.user_id
    ) pred ON pred.user_id = u.id`;
}

router.get('/:groupId/standings', authRequired, groupMemberRequired, async (req, res) => {
  const { competitionId } = req.query;
  const compIds = (await all('SELECT competition_id FROM group_competitions WHERE group_id = ?', [req.groupId]))
    .map(r => r.competition_id);

  const { sql: matchFilter, params: matchParams } = buildMatchFilter(
    competitionId ? Number(competitionId) : null,
    compIds
  );

  const rows = await all(
    `SELECT u.id, u.display_name, u.avatar, u.profile_color,
            COALESCE(pred.pred_points, 0) as pred_points,
            COALESCE(pred.exact_count, 0) as exact_count,
            COALESCE(pred.diff_count, 0) as diff_count,
            COALESCE(pred.winner_count, 0) as winner_count,
            COALESCE(pred.miss_count, 0) as miss_count,
            COALESCE(pred.scored_count, 0) as scored_count
     FROM users u
     JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ?
     ${scoredPredictionsJoin(matchFilter, req.groupId)}
     GROUP BY u.id`,
    [req.groupId, ...matchParams, req.groupId]
  );

  const bonusRows = await all(
    `SELECT user_id, COALESCE(SUM(points), 0) as xi_points FROM season_xi_points sx
     WHERE group_id = ? AND ${ACTIVE_SEASON_XI} ${competitionId ? 'AND competition_id = ?' : ''} GROUP BY user_id`,
    competitionId ? [req.groupId, Number(competitionId)] : [req.groupId]
  );
  const bonusMap = Object.fromEntries(bonusRows.map(b => [b.user_id, b.xi_points]));

  const specialRows = await all(
    `SELECT user_id, COALESCE(SUM(points), 0) as special_points FROM special_bets sb
     WHERE group_id = ? AND ${ACTIVE_SEASON_SPECIAL} ${competitionId ? 'AND competition_id = ?' : ''} GROUP BY user_id`,
    competitionId ? [req.groupId, Number(competitionId)] : [req.groupId]
  );
  const specialMap = Object.fromEntries(specialRows.map(s => [s.user_id, s.special_points]));

  res.json(withRanks(rows.map((r) => {
    const specialPoints = specialMap[r.id] ?? 0;
    const scoredCount = Number(r.scored_count ?? 0);
    const missCount = Number(r.miss_count ?? 0);
    const hitCount = r.exact_count + r.diff_count + r.winner_count;
    const precision = scoredCount > 0 ? Math.round((hitCount / scoredCount) * 100) : 0;
    const avgPerMatch = scoredCount > 0 ? Number((r.pred_points / scoredCount).toFixed(2)) : 0;
    return {
      userId: r.id,
      displayName: r.display_name,
      avatar: r.avatar,
      profileColor: r.profile_color,
      predPoints: r.pred_points,
      xiPoints: bonusMap[r.id] ?? 0,
      specialPoints,
      totalPoints: r.pred_points + (bonusMap[r.id] ?? 0) + specialPoints,
      exactCount: r.exact_count,
      diffCount: r.diff_count,
      winnerCount: r.winner_count,
      missCount,
      scoredCount,
      precision,
      avgPerMatch,
    };
  })));
});

router.get('/:groupId/standings/matchday/:matchday', authRequired, groupMemberRequired, async (req, res) => {
  const { competitionId } = req.query;
  const matchday = Number(req.params.matchday);

  let sql = `SELECT u.id, u.display_name, u.avatar,
             COALESCE(SUM(CASE WHEN m.id IS NOT NULL THEN p.points ELSE 0 END), 0) as points,
             COALESCE(SUM(CASE WHEN m.id IS NOT NULL AND p.points_detail = 'exact' THEN 1 ELSE 0 END), 0) as exact_count,
             COALESCE(SUM(CASE WHEN m.id IS NOT NULL AND p.points_detail = 'diff' THEN 1 ELSE 0 END), 0) as diff_count,
             COALESCE(SUM(CASE WHEN m.id IS NOT NULL AND p.points_detail = 'winner' THEN 1 ELSE 0 END), 0) as winner_count
             FROM users u
             JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ?
             LEFT JOIN predictions p ON p.user_id = u.id AND p.group_id = ?
             LEFT JOIN matches m ON m.id = p.match_id
               AND m.matchday = ?
               AND ${ACTIVE_SEASON_MATCH}
               AND m.status IN ${FINISHED_STATUSES}`;
  const params = [req.groupId, req.groupId, matchday];
  if (competitionId) { sql += ' AND m.competition_id = ?'; params.push(Number(competitionId)); }
  sql += ' GROUP BY u.id';

  const rows = await all(sql, params);
  res.json(withRanks(rows.map((r) => ({
    ...r,
    total: Number(r.points),
    exactCount: Number(r.exact_count),
    diffCount: Number(r.diff_count),
    winnerCount: Number(r.winner_count),
  }))));
});

router.get('/:groupId/standings/history', authRequired, groupMemberRequired, async (req, res) => {
  const raw = req.query.competitionId ? Number(req.query.competitionId) : null;
  const competitionId = Number.isFinite(raw) && raw > 0 ? raw : null;
  try {
    res.json(await buildRankingHistory(req.groupId, { competitionId }));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

router.get('/:groupId/standings/official/:competitionId', authRequired, groupMemberRequired, async (req, res) => {
  const compId = Number(req.params.competitionId);
  const member = await get(
    'SELECT 1 FROM group_competitions WHERE group_id = ? AND competition_id = ?',
    [req.groupId, compId]
  );
  if (!member) return res.status(403).json({ error: 'Championnat non suivi par ce groupe' });

  const season = await getCompetitionSeason(compId);
  let rows = await all(
    'SELECT * FROM official_standings WHERE competition_id = ? AND season = ? ORDER BY position',
    [compId, season]
  );
  rows = decorateStandingZones(dedupeStandingsRows(rows), (await get('SELECT code FROM competitions WHERE id = ?', [compId]))?.code);
  res.json(rows);
});

function decorateStandingZones(rows, compCode) {
  const withStored = applyZonesToRows(rows, []);
  if (withStored.some(r => r.zone_key)) return withStored;
  return applyZonesToRows(rows, defaultEuropeanZones(compCode, rows.length));
}

function dedupeStandingsRows(rows) {
  const byPos = new Map();
  for (const r of rows) {
    const pos = Number(r.position);
    if (!pos) continue;
    const existing = byPos.get(pos);
    if (!existing || (r.points ?? 0) > (existing.points ?? 0)) byPos.set(pos, r);
  }
  return [...byPos.values()].sort((a, b) => a.position - b.position);
}
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
    const season = c.saison_active ?? '2025-2026';
    let rows = await all(
      'SELECT position, team_id, team_name, played, won, drawn, lost, goals_for, goals_against, points, zone_key, zone_label, zone_type, updated_at FROM official_standings WHERE competition_id = ? AND season = ? ORDER BY position',
      [c.id, season]
    );
    rows = decorateStandingZones(dedupeStandingsRows(rows), c.code);
    result.push({
      competition: {
        id: c.id, code: c.code, nom: c.nom, emoji: c.emoji, logo: c.logo,
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
     FROM predictions p JOIN matches m ON m.id = p.match_id AND ${ACTIVE_SEASON_MATCH}
     WHERE p.user_id = ? AND p.group_id = ? AND p.points IS NOT NULL
       AND m.status IN ${FINISHED_STATUSES}
     GROUP BY m.matchday, m.competition_id ORDER BY m.kickoff_at`,
    [userId, req.groupId]
  );

  const xiTimeline = await all(
    `SELECT matchday, competition_id, points FROM season_xi_points sx
     WHERE user_id = ? AND group_id = ? AND ${ACTIVE_SEASON_XI} ORDER BY matchday`,
    [userId, req.groupId]
  );

  res.json({ timeline, xiTimeline });
});

/** Stats groupe : moyennes, évolution, fiches joueurs */
router.get('/:groupId/analytics', authRequired, groupMemberRequired, async (req, res) => {
  const compIds = (await all('SELECT competition_id FROM group_competitions WHERE group_id = ?', [req.groupId]))
    .map(r => r.competition_id);
  const compFilter = compIds.length
    ? ` AND m.competition_id IN (${compIds.map(() => '?').join(',')})`
    : '';
  const compParams = [...compIds];

  const membersRaw = await all(
    `SELECT u.id, u.display_name, u.avatar, u.profile_color,
            COALESCE(pred.pred_points, 0) as pred_points,
            COALESCE(pred.exact_count, 0) as exact_count,
            COALESCE(pred.diff_count, 0) as diff_count,
            COALESCE(pred.winner_count, 0) as winner_count,
            COALESCE(pred.miss_count, 0) as miss_count,
            COALESCE(pred.scored_count, 0) as scored_count
     FROM users u
     JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ?
     ${scoredPredictionsJoin(compFilter, req.groupId)}
     GROUP BY u.id`,
    [req.groupId, ...compParams, req.groupId]
  );

  const xiMap = Object.fromEntries(
    (await all(`SELECT user_id, COALESCE(SUM(points), 0) as n FROM season_xi_points sx
      WHERE group_id = ? AND ${ACTIVE_SEASON_XI} GROUP BY user_id`, [req.groupId]))
      .map(r => [r.user_id, r.n])
  );
  const specialMap = Object.fromEntries(
    (await all(`SELECT user_id, COALESCE(SUM(points), 0) as n FROM special_bets sb
      WHERE group_id = ? AND ${ACTIVE_SEASON_SPECIAL} GROUP BY user_id`, [req.groupId]))
      .map(r => [r.user_id, r.n])
  );

  const members = withRanks(membersRaw.map(r => {
    const scoredCount = Number(r.scored_count ?? 0);
    const hitCount = r.exact_count + r.diff_count + r.winner_count;
    const predPoints = Number(r.pred_points);
    const xiPoints = Number(xiMap[r.id] ?? 0);
    const specialPoints = Number(specialMap[r.id] ?? 0);
    const totalPoints = predPoints + xiPoints + specialPoints;
    return {
      userId: r.id,
      displayName: r.display_name,
      avatar: r.avatar,
      profileColor: r.profile_color,
      predPoints,
      xiPoints,
      specialPoints,
      totalPoints,
      exactCount: r.exact_count,
      diffCount: r.diff_count,
      winnerCount: r.winner_count,
      missCount: r.miss_count,
      scoredCount,
      precision: scoredCount > 0 ? Math.round((hitCount / scoredCount) * 100) : 0,
      avgPerMatch: scoredCount > 0 ? Number((predPoints / scoredCount).toFixed(2)) : 0,
    };
  }));

  const rounds = await all(
    `SELECT m.competition_id, m.matchday, MIN(m.kickoff_at) as kickoff,
            c.nom as comp_nom, c.code as comp_code
     FROM matches m
     JOIN competitions c ON c.id = m.competition_id
     WHERE m.status IN ('finished', 'FT', 'ended') AND ${ACTIVE_SEASON_MATCH} ${compFilter}
     GROUP BY m.competition_id, m.matchday
     ORDER BY kickoff ASC`,
    compParams
  );

  const roundPoints = await all(
    `SELECT m.competition_id, m.matchday, p.user_id, COALESCE(SUM(p.points), 0) as points,
            COALESCE(SUM(CASE WHEN p.points_detail = 'exact' THEN 1 ELSE 0 END), 0) as exact_count,
            COALESCE(SUM(CASE WHEN p.points_detail = 'diff' THEN 1 ELSE 0 END), 0) as diff_count,
            COALESCE(SUM(CASE WHEN p.points_detail = 'winner' THEN 1 ELSE 0 END), 0) as winner_count
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     WHERE p.group_id = ? AND p.points IS NOT NULL
       AND m.status IN ('finished', 'FT', 'ended') AND ${ACTIVE_SEASON_MATCH} ${compFilter}
     GROUP BY m.competition_id, m.matchday, p.user_id`,
    [req.groupId, ...compParams]
  );

  const xiRoundPoints = await all(
    `SELECT competition_id, matchday, user_id, COALESCE(SUM(points), 0) as points
     FROM season_xi_points sx WHERE group_id = ? AND ${ACTIVE_SEASON_XI}
     GROUP BY competition_id, matchday, user_id`,
    [req.groupId]
  );

  const pointsByRound = buildPointsByRound(roundPoints, xiRoundPoints);
  const historyRounds = accumulateHistory(
    members.map(m => ({
      userId: Number(m.userId),
      displayName: m.displayName,
      avatar: m.avatar,
      profileColor: m.profileColor,
    })),
    rounds.map(r => ({
      competitionId: Number(r.competition_id),
      matchday: Number(r.matchday),
      compCode: r.comp_code,
      compNom: r.comp_nom,
    })),
    pointsByRound,
  );
  const matchdayEvolution = historyRounds.map(r => ({
    round: r.index,
    label: r.label,
    rankings: r.rankings.map(x => ({
      userId: x.userId,
      displayName: x.displayName,
      total: x.cumulativePoints,
      exactCount: x.exactCount,
      diffCount: x.diffCount,
      winnerCount: x.winnerCount,
      rank: x.rank,
      roundPoints: x.roundPoints,
    })),
  }));

  const groupComps = await all(
    `SELECT c.id, c.code, c.nom FROM competitions c
     JOIN group_competitions gc ON gc.competition_id = c.id
     WHERE gc.group_id = ?
     ORDER BY c.nom`,
    [req.groupId]
  );

  const lastRoundByCompId = new Map();
  for (const round of rounds) {
    const prev = lastRoundByCompId.get(round.competition_id);
    if (!prev || round.kickoff > prev.kickoff) {
      lastRoundByCompId.set(round.competition_id, round);
    }
  }

  const lastMatchdayByComp = groupComps.map(c => {
    const round = lastRoundByCompId.get(c.id);
    if (!round) {
      return {
        competitionId: c.id,
        compCode: c.code,
        compNom: c.nom,
        matchday: null,
        points: {},
      };
    }
    const k = `${Number(round.competition_id)}:${Number(round.matchday)}`;
    const byUser = pointsByRound.get(k) ?? new Map();
    const points = {};
    for (const m of members) {
      points[m.userId] = byUser.get(Number(m.userId))?.predPoints ?? 0;
    }
    return {
      competitionId: c.id,
      compCode: round.comp_code,
      compNom: round.comp_nom,
      matchday: round.matchday,
      points,
    };
  });

  res.json({ members, matchdayEvolution, lastMatchdayByComp });
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
     JOIN matches m ON m.id = p.match_id AND ${ACTIVE_SEASON_MATCH}
     WHERE p.user_id = ? AND p.group_id = ?
       AND m.status IN ('finished', 'FT', 'ended') ${compFilter}`,
    [userId, req.groupId, ...compParams]
  );

  const finishedMatches = (await get(
    `SELECT COUNT(DISTINCT m.id) as n FROM matches m
     WHERE m.status IN ('finished', 'FT', 'ended') AND ${ACTIVE_SEASON_MATCH}${compFilter}`,
    compParams
  ))?.n ?? 0;

  const xiPoints = (await get(
    `SELECT COALESCE(SUM(points), 0) as n FROM season_xi_points sx
     WHERE user_id = ? AND group_id = ? AND ${ACTIVE_SEASON_XI}`,
    [userId, req.groupId]
  ))?.n ?? 0;

  const specialPoints = (await get(
    `SELECT COALESCE(SUM(points), 0) as n FROM special_bets sb
     WHERE user_id = ? AND group_id = ? AND ${ACTIVE_SEASON_SPECIAL}`,
    [userId, req.groupId]
  ))?.n ?? 0;

  // Classement général du groupe
  const allRows = await all(
    `SELECT u.id, u.display_name,
            COALESCE(pred.pred_points, 0) + COALESCE(xi.xi_pts, 0) + COALESCE(sp.special_pts, 0) as total,
            COALESCE(pred.exact_count, 0) as exact_count,
            COALESCE(pred.diff_count, 0) as diff_count,
            COALESCE(pred.winner_count, 0) as winner_count
     FROM users u
     JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ?
     ${scoredPredictionsJoin(compFilter, req.groupId)}
     LEFT JOIN (
       SELECT user_id, SUM(points) as xi_pts FROM season_xi_points sx
       WHERE group_id = ? AND ${ACTIVE_SEASON_XI} GROUP BY user_id
     ) xi ON xi.user_id = u.id
     LEFT JOIN (
       SELECT user_id, SUM(points) as special_pts FROM special_bets sb
       WHERE group_id = ? AND ${ACTIVE_SEASON_SPECIAL} GROUP BY user_id
     ) sp ON sp.user_id = u.id
     GROUP BY u.id`,
    [req.groupId, ...compParams, req.groupId, req.groupId, req.groupId]
  );

  const ranked = withRanks(allRows.map((r) => ({
    userId: r.id,
    displayName: r.display_name,
    totalPoints: Number(r.total),
    exactCount: Number(r.exact_count),
    diffCount: Number(r.diff_count),
    winnerCount: Number(r.winner_count),
  })));
  const rank = ranked.find((r) => Number(r.userId) === Number(userId))?.rank ?? Number(memberCount);
  const predPoints = Number(predStats?.pred_points ?? 0);
  const totalPoints = predPoints + Number(xiPoints) + Number(specialPoints);
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
    specialPoints: Number(specialPoints),
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

/** Duel 1v1 : comparaison entre deux joueurs sur leurs pronostics communs. */
router.get('/:groupId/duel', authRequired, groupMemberRequired, async (req, res) => {
  const userIdA = Number(req.query.a);
  const userIdB = Number(req.query.b);
  if (!userIdA || !userIdB || userIdA === userIdB) {
    return res.status(400).json({ error: 'Deux joueurs différents (a, b) sont requis' });
  }

  const users = await all(
    `SELECT u.id, u.display_name, u.avatar, u.profile_color
     FROM users u
     JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ?
     WHERE u.id IN (?, ?)`,
    [req.groupId, userIdA, userIdB]
  );
  const userA = users.find(u => u.id === userIdA);
  const userB = users.find(u => u.id === userIdB);
  if (!userA || !userB) {
    return res.status(404).json({ error: 'Joueur introuvable dans ce groupe' });
  }

  const compIds = (await all('SELECT competition_id FROM group_competitions WHERE group_id = ?', [req.groupId]))
    .map(r => r.competition_id);
  const compFilter = compIds.length
    ? ` AND m.competition_id IN (${compIds.map(() => '?').join(',')})`
    : '';
  const compParams = [...compIds];

  const commonMatches = await all(
    `SELECT m.id, m.competition_id, m.matchday, m.home_team_name, m.away_team_name,
            m.home_score, m.away_score, m.kickoff_at, c.code as comp_code,
            pa.home_score as a_home, pa.away_score as a_away, pa.points as a_points, pa.points_detail as a_detail,
            pb.home_score as b_home, pb.away_score as b_away, pb.points as b_points, pb.points_detail as b_detail
     FROM matches m
     JOIN competitions c ON c.id = m.competition_id
     JOIN predictions pa ON pa.match_id = m.id AND pa.group_id = ? AND pa.user_id = ?
     JOIN predictions pb ON pb.match_id = m.id AND pb.group_id = ? AND pb.user_id = ?
     WHERE ${ACTIVE_SEASON_MATCH} AND m.status IN ${FINISHED_STATUSES}
       AND pa.points IS NOT NULL AND pb.points IS NOT NULL ${compFilter}
     ORDER BY m.kickoff_at`,
    [req.groupId, userIdA, req.groupId, userIdB, ...compParams]
  );

  const n = commonMatches.length;
  const statsFor = (detailKey, pointsKey) => {
    const exact = commonMatches.filter(m => m[detailKey] === 'exact').length;
    const diff = commonMatches.filter(m => m[detailKey] === 'diff').length;
    const winner = commonMatches.filter(m => m[detailKey] === 'winner').length;
    const miss = commonMatches.filter(m => m[detailKey] === 'miss').length;
    const points = commonMatches.reduce((sum, m) => sum + (m[pointsKey] ?? 0), 0);
    return {
      points,
      exactCount: exact,
      diffCount: diff,
      winnerCount: winner,
      missCount: miss,
      avgPerMatch: n > 0 ? Number((points / n).toFixed(2)) : 0,
      exactPct: n > 0 ? Math.round((exact / n) * 100) : 0,
      resultPct: n > 0 ? Math.round(((exact + diff + winner) / n) * 100) : 0,
    };
  };

  const roundsMap = new Map();
  for (const m of commonMatches) {
    const key = `${m.competition_id}:${m.matchday}`;
    if (!roundsMap.has(key)) {
      roundsMap.set(key, { competitionId: m.competition_id, matchday: m.matchday, compCode: m.comp_code, pointsA: 0, pointsB: 0 });
    }
    const r = roundsMap.get(key);
    r.pointsA += m.a_points ?? 0;
    r.pointsB += m.b_points ?? 0;
  }
  const rounds = [...roundsMap.values()].map(r => ({
    ...r,
    label: `${r.compCode} · J${r.matchday}`,
    winner: r.pointsA > r.pointsB ? 'a' : r.pointsA < r.pointsB ? 'b' : 'draw',
  }));

  const duelScore = {
    a: rounds.filter(r => r.winner === 'a').length,
    b: rounds.filter(r => r.winner === 'b').length,
  };

  const last = n > 0 ? commonMatches[n - 1] : null;
  const lastMatch = last ? {
    competitionId: last.competition_id,
    compCode: last.comp_code,
    matchday: last.matchday,
    homeTeam: last.home_team_name,
    awayTeam: last.away_team_name,
    homeScore: last.home_score,
    awayScore: last.away_score,
    a: { homeScore: last.a_home, awayScore: last.a_away, points: last.a_points, detail: last.a_detail },
    b: { homeScore: last.b_home, awayScore: last.b_away, points: last.b_points, detail: last.b_detail },
  } : null;

  res.json({
    userA: { userId: userA.id, displayName: userA.display_name, avatar: userA.avatar, profileColor: userA.profile_color },
    userB: { userId: userB.id, displayName: userB.display_name, avatar: userB.avatar, profileColor: userB.profile_color },
    commonMatchesCount: n,
    duelScore,
    stats: { a: statsFor('a_detail', 'a_points'), b: statsFor('b_detail', 'b_points') },
    rounds,
    lastMatch,
  });
});

export default router;

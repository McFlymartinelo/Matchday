import { all } from '../db/connection.js';
import { withRanks } from './scoring.js';

const ACTIVE_SEASON_MATCH = `m.season = (SELECT saison_active FROM competitions WHERE id = m.competition_id)`;
const ACTIVE_SEASON_XI = `sx.season = (SELECT saison_active FROM competitions WHERE id = sx.competition_id)`;
const FINISHED_STATUSES = `('finished', 'FT', 'ended')`;

export function roundKey(compId, matchday) {
  return `${Number(compId)}:${Number(matchday)}`;
}

export function matchdayKey(matchday) {
  return `md:${Number(matchday)}`;
}

function emptyPoints() {
  return { predPoints: 0, fullPoints: 0, exactCount: 0, diffCount: 0, winnerCount: 0 };
}

function fillPointsMap(predRows, xiRows, keyOf) {
  const map = new Map();
  const ensure = (key, userId) => {
    if (!map.has(key)) map.set(key, new Map());
    const byUser = map.get(key);
    if (!byUser.has(userId)) byUser.set(userId, emptyPoints());
    return byUser.get(userId);
  };

  for (const r of predRows) {
    const userId = Number(r.user_id);
    const row = ensure(keyOf(r), userId);
    const pts = Number(r.points ?? 0);
    row.predPoints += pts;
    row.fullPoints += pts;
    row.exactCount += Number(r.exact_count ?? 0);
    row.diffCount += Number(r.diff_count ?? 0);
    row.winnerCount += Number(r.winner_count ?? 0);
  }

  for (const r of xiRows) {
    const userId = Number(r.user_id);
    const row = ensure(keyOf(r), userId);
    row.fullPoints += Number(r.points ?? 0);
  }

  return map;
}

/** Agrège par (championnat, journée, user). */
export function buildPointsByRound(predRows, xiRows) {
  return fillPointsMap(predRows, xiRows, r => roundKey(r.competition_id, r.matchday));
}

/** Agrège par journée globale (tous championnats). */
export function buildPointsByMatchday(predRows, xiRows) {
  return fillPointsMap(predRows, xiRows, r => matchdayKey(r.matchday));
}

/**
 * Cumul + rang dense après chaque round. Sans I/O.
 */
export function accumulateHistory(participants, rounds, pointsByRound) {
  const cumulative = new Map(participants.map(p => [p.userId, {
    total: 0, exactCount: 0, diffCount: 0, winnerCount: 0,
  }]));

  return rounds.map((round, idx) => {
    const key = round.key
      ?? (round.competitionId != null
        ? roundKey(round.competitionId, round.matchday)
        : matchdayKey(round.matchday));
    const byUser = pointsByRound.get(key) ?? new Map();
    const label = round.label
      ?? (round.compCode ? `${round.compCode} · J${round.matchday}` : `J${round.matchday}`);

    for (const p of participants) {
      const pts = byUser.get(p.userId);
      const cur = cumulative.get(p.userId);
      cur.total += pts?.fullPoints ?? 0;
      cur.exactCount += pts?.exactCount ?? 0;
      cur.diffCount += pts?.diffCount ?? 0;
      cur.winnerCount += pts?.winnerCount ?? 0;
    }

    const ranked = withRanks(participants.map(p => {
      const cur = cumulative.get(p.userId);
      const pts = byUser.get(p.userId);
      return {
        userId: p.userId,
        displayName: p.displayName,
        total: cur.total,
        exactCount: cur.exactCount,
        diffCount: cur.diffCount,
        winnerCount: cur.winnerCount,
        roundPoints: pts?.fullPoints ?? 0,
      };
    }));

    return {
      index: idx + 1,
      label,
      competitionId: round.competitionId,
      compCode: round.compCode ?? null,
      matchday: round.matchday,
      rankings: ranked.map(r => ({
        userId: r.userId,
        displayName: r.displayName,
        rank: r.rank,
        roundPoints: r.roundPoints,
        cumulativePoints: r.total,
        exactCount: r.exactCount,
        diffCount: r.diffCount,
        winnerCount: r.winnerCount,
      })),
    };
  });
}

function toParticipant(row) {
  return {
    userId: Number(row.id),
    displayName: row.display_name,
    avatar: row.avatar,
    profileColor: row.profile_color,
  };
}

/**
 * Historique du classement groupe, recalculé à la volée.
 * @param {number} groupId
 * @param {{ competitionId?: number | null }} [opts]
 */
export async function buildRankingHistory(groupId, { competitionId } = {}) {
  const groupComps = await all(
    'SELECT competition_id FROM group_competitions WHERE group_id = ?',
    [groupId]
  );
  const compIds = groupComps.map(r => Number(r.competition_id));
  const filterId = competitionId != null ? Number(competitionId) : null;
  const ids = filterId ? [filterId] : compIds;

  const participants = (await all(
    `SELECT u.id, u.display_name, u.avatar, u.profile_color
     FROM users u
     JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ?
     ORDER BY u.display_name COLLATE NOCASE`,
    [groupId]
  )).map(toParticipant);

  if (filterId && !compIds.includes(filterId)) {
    return { participants, rounds: [] };
  }

  const compFilter = ids.length
    ? ` AND m.competition_id IN (${ids.map(() => '?').join(',')})`
    : '';
  const compParams = [...ids];

  const roundsRaw = await all(
    `SELECT m.matchday, MIN(m.kickoff_at) as kickoff
     FROM matches m
     WHERE m.status IN ${FINISHED_STATUSES} AND ${ACTIVE_SEASON_MATCH} ${compFilter}
     GROUP BY m.matchday
     ORDER BY m.matchday ASC`,
    compParams
  );

  const predRows = await all(
    `SELECT m.matchday, p.user_id, COALESCE(SUM(p.points), 0) as points,
            COALESCE(SUM(CASE WHEN p.points_detail = 'exact' THEN 1 ELSE 0 END), 0) as exact_count,
            COALESCE(SUM(CASE WHEN p.points_detail = 'diff' THEN 1 ELSE 0 END), 0) as diff_count,
            COALESCE(SUM(CASE WHEN p.points_detail = 'winner' THEN 1 ELSE 0 END), 0) as winner_count
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     WHERE p.group_id = ? AND p.points IS NOT NULL
       AND m.status IN ${FINISHED_STATUSES} AND ${ACTIVE_SEASON_MATCH} ${compFilter}
     GROUP BY m.matchday, p.user_id`,
    [groupId, ...compParams]
  );

  let xiSql = `SELECT matchday, user_id, COALESCE(SUM(points), 0) as points
    FROM season_xi_points sx WHERE group_id = ? AND ${ACTIVE_SEASON_XI}`;
  const xiParams = [groupId];
  if (ids.length) {
    xiSql += ` AND competition_id IN (${ids.map(() => '?').join(',')})`;
    xiParams.push(...ids);
  }
  xiSql += ' GROUP BY matchday, user_id';
  const xiRows = await all(xiSql, xiParams);

  const rounds = accumulateHistory(
    participants,
    roundsRaw.map(r => {
      const matchday = Number(r.matchday);
      return {
        matchday,
        label: `J${matchday}`,
        key: matchdayKey(matchday),
        competitionId: filterId,
      };
    }),
    buildPointsByMatchday(predRows, xiRows),
  );

  return { participants, rounds };
}

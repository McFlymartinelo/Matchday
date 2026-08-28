import { all, get, run } from '../db/connection.js';
import { normalizeTeamName } from '../services/bsd.js';

const FINISHED_STATUSES = new Set(['finished', 'FT', 'ended']);
const LIVE_STATUSES = new Set(['live', 'inprogress']);
const ABANDONED_STATUSES = new Set(['postponed', 'cancelled', 'canceled']);

export function buildFixtureKey(match) {
  const home = match.home_bsd_team_id ?? normalizeTeamName(match.home_team_name);
  const away = match.away_bsd_team_id ?? normalizeTeamName(match.away_team_name);
  // Même journée + mêmes équipes = un seul match (BSD peut dupliquer avec kickoff légèrement différent).
  return `${match.competition_id}|${match.matchday ?? ''}|${home}|${away}`;
}

/** True si `a` est une version plus à jour que `b` (replay, score, statut). */
export function isRicherMatch(a, b) {
  const aDone = FINISHED_STATUSES.has(a.status) && a.home_score != null && a.away_score != null;
  const bDone = FINISHED_STATUSES.has(b.status) && b.home_score != null && b.away_score != null;
  if (aDone !== bDone) return aDone;

  const aLive = LIVE_STATUSES.has(a.status);
  const bLive = LIVE_STATUSES.has(b.status);
  if (aLive !== bLive) return aLive;

  const aDead = ABANDONED_STATUSES.has(a.status);
  const bDead = ABANDONED_STATUSES.has(b.status);
  if (aDead !== bDead) return !aDead;

  if ((a.home_score != null) !== (b.home_score != null)) return a.home_score != null;

  const aKick = Date.parse(a.kickoff_at ?? '') || 0;
  const bKick = Date.parse(b.kickoff_at ?? '') || 0;
  if (aKick !== bKick) return aKick > bKick;

  return (a.bsd_event_id ?? 0) > (b.bsd_event_id ?? 0);
}

function pickBestDuplicate(a, b) {
  const richer = isRicherMatch(a, b) ? a : b;
  const other = richer === a ? b : a;
  const prediction = richer.prediction ?? other.prediction ?? null;
  if (prediction && richer.prediction !== prediction) {
    return { ...richer, prediction };
  }
  return richer;
}

/** Retire les doublons (même affiche BSD importée deux fois). */
export function dedupeMatches(matches) {
  const byKey = new Map();
  for (const m of matches) {
    const key = buildFixtureKey(m);
    const existing = byKey.get(key);
    byKey.set(key, existing ? pickBestDuplicate(existing, m) : m);
  }
  return [...byKey.values()];
}

async function mergeMatchInto(keepId, dropId) {
  const keep = await get('SELECT * FROM matches WHERE id = ?', [keepId]);
  const drop = await get('SELECT * FROM matches WHERE id = ?', [dropId]);

  await run(
    `DELETE FROM predictions WHERE match_id = ? AND (user_id, group_id) IN (
       SELECT user_id, group_id FROM predictions WHERE match_id = ?
     )`,
    [dropId, keepId]
  );
  await run('UPDATE predictions SET match_id = ? WHERE match_id = ?', [keepId, dropId]);
  await run('UPDATE notification_log SET match_id = ? WHERE match_id = ?', [keepId, dropId]);

  if (keep && drop && isRicherMatch(drop, keep)) {
    await run('UPDATE matches SET bsd_event_id = NULL WHERE id = ?', [dropId]);
    await run(
      `UPDATE matches SET
         bsd_event_id = ?, home_score = ?, away_score = ?, status = ?,
         kickoff_at = ?, home_team_name = ?, away_team_name = ?,
         home_bsd_team_id = ?, away_bsd_team_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        drop.bsd_event_id, drop.home_score, drop.away_score, drop.status,
        drop.kickoff_at, drop.home_team_name, drop.away_team_name,
        drop.home_bsd_team_id, drop.away_bsd_team_id, keepId,
      ]
    );
  }

  await run('DELETE FROM matches WHERE id = ?', [dropId]);
}

/** Fusionne les matchs en double persistés (BSD ids différents, même affiche). */
export async function dedupeCompetitionMatches(competitionId) {
  const rows = await all(
    'SELECT * FROM matches WHERE competition_id = ? ORDER BY id ASC',
    [competitionId]
  );

  const keeperByKey = new Map();
  let merged = 0;

  for (const row of rows) {
    const key = buildFixtureKey(row);
    const keepId = keeperByKey.get(key);
    if (!keepId) {
      keeperByKey.set(key, row.id);
      continue;
    }
    await mergeMatchInto(keepId, row.id);
    merged++;
  }

  return merged;
}

/** Déduplique les événements BSD avant insertion. */
export function dedupeBsdEvents(events, competitionId, normalizeEvent) {
  const byKey = new Map();
  for (const event of events) {
    const norm = normalizeEvent(event, competitionId);
    if (!norm.kickoff_at) continue;
    const key = buildFixtureKey(norm);
    const existing = byKey.get(key);
    if (!existing || isRicherMatch(norm, existing)) {
      byKey.set(key, norm);
    }
  }
  return [...byKey.values()];
}

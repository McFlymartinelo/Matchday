import { all, run } from '../db/connection.js';
import { normalizeTeamName } from '../services/bsd.js';

export function buildFixtureKey(match) {
  const home = match.home_bsd_team_id ?? normalizeTeamName(match.home_team_name);
  const away = match.away_bsd_team_id ?? normalizeTeamName(match.away_team_name);
  // Même journée + mêmes équipes = un seul match (BSD peut dupliquer avec kickoff légèrement différent).
  return `${match.competition_id}|${match.matchday ?? ''}|${home}|${away}`;
}

function pickBestDuplicate(a, b) {
  if (a.prediction && !b.prediction) return a;
  if (b.prediction && !a.prediction) return b;
  if (a.bsd_event_id && !b.bsd_event_id) return a;
  if (b.bsd_event_id && !a.bsd_event_id) return b;
  return (a.id ?? 0) < (b.id ?? 0) ? a : b;
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
  await run(
    `DELETE FROM predictions WHERE match_id = ? AND (user_id, group_id) IN (
       SELECT user_id, group_id FROM predictions WHERE match_id = ?
     )`,
    [dropId, keepId]
  );
  await run('UPDATE predictions SET match_id = ? WHERE match_id = ?', [keepId, dropId]);
  await run('UPDATE notification_log SET match_id = ? WHERE match_id = ?', [keepId, dropId]);
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
    if (!existing || (norm.bsd_event_id ?? 0) > (existing.bsd_event_id ?? 0)) {
      byKey.set(key, norm);
    }
  }
  return [...byKey.values()];
}

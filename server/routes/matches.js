import { Router } from 'express';
import { all, get, run } from '../db/connection.js';
import { authRequired, groupMemberRequired } from '../middleware/auth.js';
import { filterMatchesByGroupCompetitions } from '../lib/scoring.js';
import { scorePrediction } from '../lib/scoring.js';
import * as bsd from '../services/bsd.js';

const router = Router();

async function getGroupCompetitionIds(groupId) {
  const rows = await all('SELECT competition_id FROM group_competitions WHERE group_id = ?', [groupId]);
  return rows.map(r => r.competition_id);
}

router.get('/:groupId/matches', authRequired, groupMemberRequired, async (req, res) => {
  const compIds = await getGroupCompetitionIds(req.groupId);
  if (compIds.length === 0) return res.json([]);

  const placeholders = compIds.map(() => '?').join(',');
  const { competitionId, matchday } = req.query;

  let sql = `SELECT m.*, c.code as comp_code, c.nom as comp_nom, c.couleur, c.couleur_bg, c.emoji
             FROM matches m JOIN competitions c ON c.id = m.competition_id
             WHERE m.competition_id IN (${placeholders})`;
  const params = [...compIds];

  if (competitionId) { sql += ' AND m.competition_id = ?'; params.push(Number(competitionId)); }
  if (matchday) { sql += ' AND m.matchday = ?'; params.push(Number(matchday)); }

  sql += ' ORDER BY m.kickoff_at ASC';
  let matches = await all(sql, params);

  // Filtrage serveur explicite
  matches = filterMatchesByGroupCompetitions(matches, compIds);

  const predictions = await all(
    'SELECT match_id, home_score, away_score, points, points_detail FROM predictions WHERE group_id = ? AND user_id = ?',
    [req.groupId, req.user.id]
  );
  const predMap = Object.fromEntries(predictions.map(p => [p.match_id, p]));

  res.json(matches.map(m => ({
    ...m,
    prediction: predMap[m.id] ?? null,
    isLocked: new Date(m.kickoff_at) <= new Date() || ['live', 'finished', 'FT'].includes(m.status),
  })));
});

router.get('/:groupId/matches/:matchId', authRequired, groupMemberRequired, async (req, res) => {
  const match = await get(
    `SELECT m.*, c.nom as comp_nom, c.couleur FROM matches m
     JOIN competitions c ON c.id = m.competition_id WHERE m.id = ?`,
    [req.params.matchId]
  );
  if (!match) return res.status(404).json({ error: 'Match introuvable' });

  const compIds = await getGroupCompetitionIds(req.groupId);
  if (!compIds.includes(match.competition_id)) {
    return res.status(403).json({ error: 'Championnat non suivi par ce groupe' });
  }

  let unavailable = [];
  let h2h = [];
  if (match.bsd_event_id) {
    try {
      const unavail = await bsd.getUnavailable(match.bsd_event_id);
      unavailable = unavail.results ?? unavail.unavailable ?? [];
    } catch { /* BSD indisponible */ }
  }

  const groupPreds = await all(
    `SELECT p.*, u.display_name, u.avatar FROM predictions p
     JOIN users u ON u.id = p.user_id
     WHERE p.group_id = ? AND p.match_id = ?`,
    [req.groupId, match.id]
  );

  res.json({ match, unavailable, h2h, predictions: groupPreds });
});

router.post('/:groupId/predictions', authRequired, groupMemberRequired, async (req, res) => {
  const { matchId, homeScore, awayScore } = req.body;
  const match = await get('SELECT * FROM matches WHERE id = ?', [matchId]);
  if (!match) return res.status(404).json({ error: 'Match introuvable' });

  const compIds = await getGroupCompetitionIds(req.groupId);
  if (!compIds.includes(match.competition_id)) {
    return res.status(403).json({ error: 'Championnat non suivi' });
  }

  if (new Date(match.kickoff_at) <= new Date()) {
    return res.status(400).json({ error: 'Pronostic verrouillé — match déjà commencé' });
  }

  await run(
    `INSERT INTO predictions (user_id, group_id, match_id, home_score, away_score, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, group_id, match_id) DO UPDATE SET
       home_score = excluded.home_score, away_score = excluded.away_score, updated_at = datetime('now')`,
    [req.user.id, req.groupId, matchId, homeScore, awayScore]
  );
  res.json({ ok: true });
});

router.post('/:groupId/predictions/:predictionId/reactions', authRequired, groupMemberRequired, async (req, res) => {
  const { emoji } = req.body;
  await run(
    `INSERT INTO prediction_reactions (prediction_id, user_id, emoji) VALUES (?, ?, ?)
     ON CONFLICT(prediction_id, user_id, emoji) DO NOTHING`,
    [req.params.predictionId, req.user.id, emoji]
  );
  res.json({ ok: true });
});

router.post('/:groupId/recalculate', authRequired, groupMemberRequired, async (req, res) => {
  const group = await get('SELECT * FROM groups WHERE id = ?', [req.groupId]);
  const compIds = await getGroupCompetitionIds(req.groupId);
  const scoring = { exact: group.scoring_exact, diff: group.scoring_diff, winner: group.scoring_winner };

  const preds = await all(
    `SELECT p.*, m.home_score as actual_home, m.away_score as actual_away FROM predictions p
     JOIN matches m ON m.id = p.match_id
     WHERE p.group_id = ? AND m.competition_id IN (${compIds.map(() => '?').join(',')})
       AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL`,
    [req.groupId, ...compIds]
  );

  for (const p of preds) {
    const points = scorePrediction(
      Number(p.home_score), Number(p.away_score),
      Number(p.actual_home), Number(p.actual_away), scoring
    );
    await run(
      'UPDATE predictions SET points = ?, points_detail = ? WHERE id = ?',
      [points.points, points.detail, p.id]
    );
  }

  res.json({ ok: true, recalculated: preds.length });
});

export default router;

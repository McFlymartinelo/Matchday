import { Router } from 'express';
import { all, get, run } from '../db/connection.js';
import { authRequired, groupMemberRequired } from '../middleware/auth.js';
import { scoreSpecialBet } from '../lib/scoring.js';
import { scoreChampionBetsForCompetition } from '../lib/championBets.js';
import { getCompetitionSeason } from '../lib/season.js';

const router = Router();

router.get('/:groupId/special-bets', authRequired, groupMemberRequired, async (req, res) => {
  const rows = await all(
    'SELECT * FROM special_bets WHERE group_id = ? AND user_id = ?',
    [req.groupId, req.user.id]
  );
  res.json(rows.map(r => ({
    id: r.id,
    competitionId: r.competition_id,
    betType: r.bet_type,
    betValue: r.bet_value,
    points: r.points,
    season: r.season,
  })));
});

router.get('/:groupId/special-bets/teams/:competitionId', authRequired, groupMemberRequired, async (req, res) => {
  const compId = Number(req.params.competitionId);
  const member = await get(
    'SELECT 1 FROM group_competitions WHERE group_id = ? AND competition_id = ?',
    [req.groupId, compId]
  );
  if (!member) return res.status(403).json({ error: 'Championnat non suivi' });

  const season = await getCompetitionSeason(compId);
  let teams = await all(
    'SELECT team_name FROM official_standings WHERE competition_id = ? AND season = ? ORDER BY position',
    [compId, season]
  );
  if (!teams.length) {
    teams = await all(
      `SELECT team_name FROM (
         SELECT home_team_name AS team_name FROM matches WHERE competition_id = ? AND season = ?
         UNION SELECT away_team_name FROM matches WHERE competition_id = ? AND season = ?
       ) ORDER BY team_name`,
      [compId, season, compId, season]
    );
  }
  res.json(teams.map(t => t.team_name));
});

router.post('/:groupId/special-bets', authRequired, groupMemberRequired, async (req, res) => {
  const { competitionId, betType, betValue, season: seasonBody } = req.body;
  if (!competitionId || !betType || !betValue) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  const season = seasonBody ?? await getCompetitionSeason(Number(competitionId));

  const member = await get(
    'SELECT 1 FROM group_competitions WHERE group_id = ? AND competition_id = ?',
    [req.groupId, Number(competitionId)]
  );
  if (!member) return res.status(403).json({ error: 'Championnat non suivi' });

  await run(
    `INSERT INTO special_bets (user_id, group_id, competition_id, season, bet_type, bet_value)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, group_id, competition_id, season, bet_type) DO UPDATE SET bet_value = excluded.bet_value`,
    [req.user.id, req.groupId, competitionId, season, betType, betValue]
  );

  if (betType === 'champion') {
    await scoreChampionBetsForCompetition(Number(competitionId), season);
  }

  const row = await get(
    `SELECT * FROM special_bets WHERE user_id = ? AND group_id = ? AND competition_id = ? AND season = ? AND bet_type = ?`,
    [req.user.id, req.groupId, competitionId, season, betType]
  );
  res.json({
    ok: true,
    bet: row ? {
      competitionId: row.competition_id,
      betType: row.bet_type,
      betValue: row.bet_value,
      points: row.points,
      season: row.season,
    } : null,
  });
});

export { scoreSpecialBet };
export default router;

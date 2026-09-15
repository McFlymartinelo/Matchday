import { Router } from 'express';
import { all, get, run } from '../db/connection.js';
import { authRequired, groupMemberRequired } from '../middleware/auth.js';
import { scoreSpecialBet } from '../lib/scoring.js';
import { scoreChampionBetsForCompetition } from '../lib/championBets.js';
import { getCompetitionSeason } from '../lib/season.js';
import { isChampionBetOpen } from '../lib/competitions.js';
import { RANKED_MEMBERS_WHERE } from '../lib/standingsVisibility.js';

const router = Router();

const COMP_ORDER = `CASE c.code
  WHEN 'L1' THEN 1 WHEN 'PL' THEN 2 WHEN 'PD' THEN 3
  WHEN 'SA' THEN 4 WHEN 'BL1' THEN 5 WHEN 'LDC' THEN 6 ELSE 9 END`;

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

router.get('/:groupId/special-bets/group', authRequired, groupMemberRequired, async (req, res) => {
  const comps = await all(
    `SELECT c.id, c.code, c.nom, c.emoji, c.logo, c.couleur, c.couleur_bg, c.saison_active
     FROM competitions c
     JOIN group_competitions gc ON gc.competition_id = c.id
     WHERE gc.group_id = ?
     ORDER BY ${COMP_ORDER}, c.nom`,
    [req.groupId]
  );
  const members = await all(
    `SELECT u.id, u.display_name, u.avatar, u.profile_color
     FROM users u
     JOIN group_members gm ON gm.user_id = u.id
     WHERE gm.group_id = ? AND ${RANKED_MEMBERS_WHERE}
     ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, u.display_name COLLATE NOCASE`,
    [req.groupId, req.user.id]
  );
  const bets = await all(
    `SELECT sb.user_id, sb.competition_id, sb.bet_value, sb.points, sb.season
     FROM special_bets sb
     JOIN competitions c ON c.id = sb.competition_id
     JOIN group_competitions gc ON gc.competition_id = c.id AND gc.group_id = sb.group_id
     WHERE sb.group_id = ? AND sb.bet_type = 'champion' AND sb.season = c.saison_active`,
    [req.groupId]
  );

  const competitions = comps.map(c => ({
    id: c.id,
    code: c.code,
    nom: c.nom,
    emoji: c.emoji,
    logo: c.logo,
    couleur: c.couleur,
    couleurBg: c.couleur_bg,
    season: c.saison_active,
    revealed: !isChampionBetOpen(c.code),
  }));
  const revealedIds = new Set(competitions.filter(c => c.revealed).map(c => c.id));
  const rankedIds = new Set(members.map(u => u.id));

  res.json({
    competitions,
    members: members.map(u => ({
      userId: u.id,
      displayName: u.display_name,
      avatar: u.avatar,
      profileColor: u.profile_color,
    })),
    bets: bets
      .filter(b => rankedIds.has(b.user_id) && (revealedIds.has(b.competition_id) || b.user_id === req.user.id))
      .map(b => ({
        userId: b.user_id,
        competitionId: b.competition_id,
        betValue: b.bet_value,
        points: b.points,
        season: b.season,
      })),
  });
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

  const comp = await get('SELECT code FROM competitions WHERE id = ?', [Number(competitionId)]);
  if (betType === 'champion' && !isChampionBetOpen(comp?.code)) {
    const msg = comp?.code === 'LDC'
      ? 'Les pronos vainqueur LDC sont verrouillés'
      : 'Les pronos vainqueur sont verrouillés depuis le 4 septembre';
    return res.status(403).json({ error: msg });
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

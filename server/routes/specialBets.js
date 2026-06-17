import { Router } from 'express';
import { all, run } from '../db/connection.js';
import { authRequired, groupMemberRequired } from '../middleware/auth.js';
import { scoreSpecialBet } from '../lib/scoring.js';

const router = Router();

router.get('/:groupId/special-bets', authRequired, groupMemberRequired, async (req, res) => {
  const rows = await all(
    'SELECT * FROM special_bets WHERE group_id = ? AND user_id = ?',
    [req.groupId, req.user.id]
  );
  res.json(rows);
});

router.post('/:groupId/special-bets', authRequired, groupMemberRequired, async (req, res) => {
  const { competitionId, betType, betValue, season = '2025-2026' } = req.body;
  if (!competitionId || !betType || !betValue) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }

  await run(
    `INSERT INTO special_bets (user_id, group_id, competition_id, season, bet_type, bet_value)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, group_id, competition_id, season, bet_type) DO UPDATE SET bet_value = excluded.bet_value`,
    [req.user.id, req.groupId, competitionId, season, betType, betValue]
  );
  res.json({ ok: true });
});

export { scoreSpecialBet };
export default router;

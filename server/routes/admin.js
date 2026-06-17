import { Router } from 'express';
import { all, get, run } from '../db/connection.js';
import { authRequired, adminRequired } from '../middleware/auth.js';
import { syncAllCompetitions, syncAllStandings, syncLiveScores, computeMatchdayXiForCompetition } from '../services/sync.js';
import bcrypt from 'bcryptjs';

const router = Router();

router.get('/users', authRequired, adminRequired, async (_req, res) => {
  const users = await all('SELECT id, username, display_name, is_admin, created_at FROM users ORDER BY id');
  res.json(users);
});

router.post('/users', authRequired, adminRequired, async (req, res) => {
  const { username, password, displayName, isAdmin } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const result = await run(
    'INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (?, ?, ?, ?)',
    [username.toLowerCase(), hash, displayName || username, isAdmin ? 1 : 0]
  );
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.delete('/users/:id', authRequired, adminRequired, async (req, res) => {
  await run('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

router.post('/sync/fixtures', authRequired, adminRequired, async (_req, res) => {
  await syncAllCompetitions();
  res.json({ ok: true });
});

router.post('/sync/scores', authRequired, adminRequired, async (_req, res) => {
  const count = await syncLiveScores();
  res.json({ ok: true, count });
});

router.post('/sync/standings', authRequired, adminRequired, async (_req, res) => {
  await syncAllStandings();
  res.json({ ok: true });
});

router.post('/sync/matchday-xi', authRequired, adminRequired, async (req, res) => {
  const { competitionId, season, matchday } = req.body;
  const result = await computeMatchdayXiForCompetition(competitionId, season ?? '2025-2026', matchday);
  res.json(result);
});

router.get('/sync-log', authRequired, adminRequired, async (_req, res) => {
  const logs = await all('SELECT * FROM sync_log ORDER BY created_at DESC LIMIT 50');
  res.json(logs);
});

router.post('/groups/:groupId/recalculate', authRequired, adminRequired, async (req, res) => {
  const group = await get('SELECT * FROM groups WHERE id = ?', [req.params.groupId]);
  if (!group) return res.status(404).json({ error: 'Groupe introuvable' });
  res.json({ ok: true, message: 'Recalcul déclenché' });
});

export default router;

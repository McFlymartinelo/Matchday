import { Router } from 'express';
import { all, get, run } from '../db/connection.js';
import { authRequired, adminRequired } from '../middleware/auth.js';
import { syncAllCompetitions, syncAllStandings, syncLiveScores, computeMatchdayXiForCompetition } from '../services/sync.js';
import {
  configureWebPush,
  seedTestReminderMatch,
  sendPredictionReminders,
  findPendingReminderTargets,
  cleanupTestReminderMatch,
} from '../services/notifications.js';
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
  const total = await syncAllCompetitions();
  res.json({ ok: true, matchCount: total });
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

/** Simule un match dans ~1h sans pronostic et déclenche le rappel push (test). */
router.post('/notifications/simulate-reminder', authRequired, adminRequired, async (req, res) => {
  const {
    userId,
    username,
    groupId = 1,
    minutes = 60,
    windowMinutes = 10,
    send = false,
    keep = false,
    home,
    away,
  } = req.body ?? {};

  let targetUserId = userId;
  if (username) {
    const u = await get('SELECT id FROM users WHERE username = ?', [String(username).toLowerCase()]);
    if (!u) return res.status(404).json({ error: `Utilisateur @${username} introuvable` });
    targetUserId = u.id;
  }
  if (!targetUserId) {
    return res.status(400).json({ error: 'userId ou username requis' });
  }

  const user = await get('SELECT id, username, display_name FROM users WHERE id = ?', [targetUserId]);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const pushCount = Number((await get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', [targetUserId]))?.n ?? 0);
  const vapid = configureWebPush();

  const seeded = await seedTestReminderMatch({
    userId: targetUserId,
    groupId: Number(groupId),
    minutes: Number(minutes),
    home,
    away,
  });

  const targets = await findPendingReminderTargets({
    userId: targetUserId,
    minutes: Number(minutes),
    windowMinutes: Number(windowMinutes),
  });

  let delivery = null;
  if (send) {
    if (!vapid.ok) {
      if (!keep) await cleanupTestReminderMatch();
      return res.status(503).json({ error: vapid.error, seeded, targets });
    }
    delivery = await sendPredictionReminders({
      userId: targetUserId,
      minutes: Number(minutes),
      windowMinutes: Number(windowMinutes),
    });
  }

  if (!keep) await cleanupTestReminderMatch();

  res.json({
    ok: true,
    dryRun: !send,
    user,
    pushSubscriptions: pushCount,
    vapidConfigured: vapid.ok,
    seeded,
    targets,
    delivery,
    kept: !!keep,
  });
});

export default router;

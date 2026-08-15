import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import {
  configureWebPush,
  getVapidPublicKey,
  savePushSubscription,
  removePushSubscription,
  removeAllPushSubscriptions,
  sendPredictionReminders,
  sendMorningReminders,
  sendTestPush,
} from '../services/notifications.js';

const router = Router();

router.get('/vapid-public-key', (_req, res) => {
  const cfg = configureWebPush();
  if (!cfg.ok) {
    return res.status(503).json({ error: cfg.error, configured: false });
  }
  res.json({ publicKey: getVapidPublicKey(), configured: true });
});

router.post('/subscribe', authRequired, async (req, res) => {
  const cfg = configureWebPush();
  if (!cfg.ok) return res.status(503).json({ error: cfg.error });

  try {
    await savePushSubscription(req.user.id, req.body);
    const test = await sendTestPush(req.user.id);
    res.json({ ok: true, test });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Envoie une notification test immédiate (auth requis). */
router.post('/test', authRequired, async (req, res) => {
  const cfg = configureWebPush();
  if (!cfg.ok) return res.status(503).json({ error: cfg.error });

  const result = await sendTestPush(req.user.id);
  if (result.skipped) return res.status(400).json({ error: result.reason, result });
  if (result.sent === 0) {
    return res.status(502).json({
      error: 'Push non délivré — réactive la cloche 🔔 dans l\'app',
      result,
    });
  }
  res.json({ ok: true, result });
});

router.post('/unsubscribe', authRequired, async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    await removePushSubscription(req.user.id, endpoint);
  } else {
    await removeAllPushSubscriptions(req.user.id);
  }
  res.json({ ok: true });
});

/** Déclenche manuellement la vérification des rappels (dev / test). */
router.post('/trigger-reminders', authRequired, async (req, res) => {
  const dryRun = req.body?.dryRun === true;
  const kind = req.body?.kind === 'morning' ? 'morning' : 'hour';
  const common = {
    dryRun,
    userId: req.user.id,
    matchId: req.body?.matchId,
    groupId: req.body?.groupId,
    skipDedup: req.body?.skipDedup === true,
    day: req.body?.day,
  };

  const result = kind === 'morning'
    ? await sendMorningReminders(common)
    : await sendPredictionReminders({
      ...common,
      minutes: req.body?.minutes,
      windowMinutes: req.body?.windowMinutes,
    });

  res.json({ kind, ...result });
});

export default router;

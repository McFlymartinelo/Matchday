import webpush from 'web-push';
import { all, get, run } from '../db/connection.js';

const REMINDER_MINUTES = Number(process.env.NOTIFICATION_REMINDER_MINUTES ?? 60);
const WINDOW_MINUTES = Number(process.env.NOTIFICATION_WINDOW_MINUTES ?? 5);

let vapidConfigured = false;

export function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@matchday.app';

  if (!publicKey || !privateKey) {
    vapidConfigured = false;
    return { ok: false, error: 'VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY manquants dans .env' };
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return { ok: true, publicKey };
}

export function getVapidPublicKey() {
  configureWebPush();
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

export function isPushConfigured() {
  configureWebPush();
  return vapidConfigured;
}

/**
 * Matchs sans pronostic dont le coup d'envoi est dans ~1h (fenêtre configurable).
 */
export async function findPendingReminderTargets(options = {}) {
  const minutes = options.minutes ?? REMINDER_MINUTES;
  const window = options.windowMinutes ?? WINDOW_MINUTES;
  const minOffset = minutes - window;
  const maxOffset = minutes + window;
  const matchId = options.matchId ?? null;

  let sql = `
    SELECT m.id AS match_id, m.competition_id, m.home_team_name, m.away_team_name, m.kickoff_at,
           gm.user_id, g.id AS group_id, g.name AS group_name, c.nom AS comp_nom
    FROM matches m
    JOIN competitions c ON c.id = m.competition_id
    JOIN group_competitions gc ON gc.competition_id = m.competition_id
    JOIN groups g ON g.id = gc.group_id
    JOIN group_members gm ON gm.group_id = g.id
    LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = gm.user_id AND p.group_id = g.id
    LEFT JOIN notification_log nl ON nl.user_id = gm.user_id AND nl.match_id = m.id AND nl.type = 'prono_reminder'
    WHERE m.status IN ('scheduled', 'notstarted')
      AND datetime(m.kickoff_at) > datetime('now')
      AND datetime(m.kickoff_at) >= datetime('now', '+${minOffset} minutes')
      AND datetime(m.kickoff_at) <= datetime('now', '+${maxOffset} minutes')
      AND p.id IS NULL
      AND nl.id IS NULL
  `;
  const params = [];
  if (matchId) {
    sql += ' AND m.id = ?';
    params.push(matchId);
  }
  if (options.userId) {
    sql += ' AND gm.user_id = ?';
    params.push(options.userId);
  }

  return all(sql, params);
}

export async function savePushSubscription(userId, subscription) {
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error('Subscription push invalide');
  }
  await run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [userId, endpoint, keys.p256dh, keys.auth]
  );
}

export async function removePushSubscription(userId, endpoint) {
  await run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, endpoint]);
}

export async function removeAllPushSubscriptions(userId) {
  await run('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
}

async function getUserSubscriptions(userId) {
  return all('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
}

export async function sendPushToUser(userId, payload) {
  if (!isPushConfigured()) {
    return { sent: 0, failed: 0, skipped: true, reason: 'VAPID non configuré' };
  }

  const subs = await getUserSubscriptions(userId);
  if (!subs.length) {
    return { sent: 0, failed: 0, skipped: true, reason: 'Aucun abonnement push — active la cloche 🔔' };
  }

  let sent = 0;
  let failed = 0;
  const errors = [];
  const body = JSON.stringify(payload);

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 86400, urgency: 'high', topic: 'matchday-reminder' }
      );
      sent++;
    } catch (err) {
      failed++;
      errors.push({ endpoint: sub.endpoint.slice(0, 40), status: err.statusCode, message: err.message });
      if (err.statusCode === 404 || err.statusCode === 410) {
        await run('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
      }
    }
  }

  return { sent, failed, skipped: false, errors };
}

export async function sendTestPush(userId) {
  return sendPushToUser(userId, {
    title: '🔔 Matchday — test',
    body: 'Les notifications fonctionnent ! Tu seras prévenu 1h avant chaque match.',
    url: '/?screen=matches',
    tag: `test-${Date.now()}`,
  });
}

export function buildMatchDeepLink({ group_id, match_id, competition_id, groupId, matchId, competitionId } = {}) {
  const g = groupId ?? group_id;
  const m = matchId ?? match_id;
  const c = competitionId ?? competition_id;
  const params = new URLSearchParams({ screen: 'matches', group: String(g), match: String(m) });
  if (c) params.set('comp', String(c));
  return `/?${params.toString()}`;
}

export function buildReminderPayload(target) {
  const kickoff = new Date(target.kickoff_at);
  const mins = Math.max(1, Math.round((kickoff - Date.now()) / 60000));
  return {
    title: '⏰ Pronostic à faire',
    body: `${target.home_team_name} vs ${target.away_team_name} dans ${mins} min (${target.group_name})`,
    url: buildMatchDeepLink(target),
    matchId: target.match_id,
    groupId: target.group_id,
    competitionId: target.competition_id,
    tag: `prono-${target.match_id}`,
  };
}

export async function sendPredictionReminders(options = {}) {
  const targets = await findPendingReminderTargets(options);
  const results = [];

  for (const t of targets) {
    const payload = buildReminderPayload(t);

    if (options.dryRun) {
      results.push({ ...t, payload, dryRun: true });
      continue;
    }

    const push = await sendPushToUser(t.user_id, payload);
    await run(
      `INSERT INTO notification_log (user_id, match_id, type) VALUES (?, ?, 'prono_reminder')`,
      [t.user_id, t.match_id]
    );
    results.push({ ...t, push, payload });
  }

  return { count: targets.length, results };
}

/** Premier groupe de l'utilisateur, ou vérifie l'appartenance si groupId fourni. */
export async function resolveUserGroupId(userId, groupId = null) {
  if (groupId) {
    const row = await get(
      `SELECT g.id, g.name FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE g.id = ? AND gm.user_id = ?`,
      [groupId, userId]
    );
    if (!row) {
      throw new Error(`Groupe ${groupId} introuvable ou l'utilisateur n'en est pas membre`);
    }
    return row;
  }

  const groups = await all(
    `SELECT g.id, g.name FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = ?
     ORDER BY g.id ASC`,
    [userId]
  );
  if (!groups.length) {
    throw new Error('Aucun groupe pour cet utilisateur');
  }
  return groups[0];
}

/** Crée un match test (coup d'envoi dans N minutes) sans pronostic. */
export async function seedTestReminderMatch(options = {}) {
  const minutes = options.minutes ?? 60;
  const userId = options.userId ?? 1;
  const kickoff = new Date(Date.now() + minutes * 60000).toISOString();
  const bsdEventId = options.bsdEventId ?? -888001;

  const group = await resolveUserGroupId(userId, options.groupId ?? null);
  const groupId = group.id;

  const comp = await get(
    `SELECT c.* FROM competitions c
     JOIN group_competitions gc ON gc.competition_id = c.id
     WHERE gc.group_id = ? LIMIT 1`,
    [groupId]
  );
  if (!comp) throw new Error('Aucun championnat dans ce groupe');

  await run('DELETE FROM notification_log WHERE match_id IN (SELECT id FROM matches WHERE bsd_event_id = ?)', [bsdEventId]);
  await run('DELETE FROM predictions WHERE match_id IN (SELECT id FROM matches WHERE bsd_event_id = ?)', [bsdEventId]);
  await run('DELETE FROM matches WHERE bsd_event_id = ?', [bsdEventId]);

  const result = await run(
    `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name,
      status, matchday, kickoff_at, season, updated_at)
     VALUES (?, ?, ?, ?, 'scheduled', 99, ?, ?, datetime('now'))`,
    [
      bsdEventId,
      comp.id,
      options.home ?? 'Paris Saint-Germain',
      options.away ?? 'Olympique de Marseille',
      kickoff,
      comp.saison_active ?? '2025-2026',
    ]
  );

  const matchId = Number(result.lastInsertRowid);
  await run(
    'DELETE FROM predictions WHERE user_id = ? AND group_id = ? AND match_id = ?',
    [userId, groupId, matchId]
  );

  return {
    matchId,
    kickoff,
    groupId,
    groupName: group.name,
    userId,
    home: options.home ?? 'Paris Saint-Germain',
    away: options.away ?? 'Olympique de Marseille',
  };
}

export async function cleanupTestReminderMatch(bsdEventId = -888001) {
  await run('DELETE FROM notification_log WHERE match_id IN (SELECT id FROM matches WHERE bsd_event_id = ?)', [bsdEventId]);
  await run('DELETE FROM predictions WHERE match_id IN (SELECT id FROM matches WHERE bsd_event_id = ?)', [bsdEventId]);
  await run('DELETE FROM matches WHERE bsd_event_id = ?', [bsdEventId]);
}

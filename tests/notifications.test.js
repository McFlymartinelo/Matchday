import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, run, get, closeDb } from '../server/db/connection.js';
import {
  seedTestReminderMatch,
  findPendingReminderTargets,
  findMorningReminderTargets,
  getParisCalendarDay,
  cleanupTestReminderMatch,
  sendPredictionReminders,
} from '../server/services/notifications.js';

describe('notifications — rappel pronostic 1h', () => {
  before(async () => {
    await migrate();
    await cleanupTestReminderMatch(-888002);
  });

  after(async () => {
    await cleanupTestReminderMatch(-888002);
    await closeDb();
  });

  it('détecte un match dans 60 min sans pronostic', async () => {
    const fixture = await get(
      `SELECT u.id AS user_id, gm.group_id
       FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       LIMIT 1`
    );
    assert.ok(fixture, 'utilisateur avec groupe requis');

    const seeded = await seedTestReminderMatch({
      userId: fixture.user_id,
      groupId: fixture.group_id,
      minutes: 60,
      bsdEventId: -888002,
      home: 'Test FC',
      away: 'Demo United',
    });

    const targets = await findPendingReminderTargets({
      userId: fixture.user_id,
      minutes: 60,
      windowMinutes: 10,
    });

    assert.ok(targets.some(t => t.match_id === seeded.matchId));
    assert.equal(targets.find(t => t.match_id === seeded.matchId)?.home_team_name, 'Test FC');
  });

  it('ignore un match déjà pronostiqué', async () => {
    const fixture = await get(
      `SELECT u.id AS user_id, gm.group_id
       FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       LIMIT 1`
    );
    assert.ok(fixture, 'utilisateur avec groupe requis');

    const seeded = await seedTestReminderMatch({
      userId: fixture.user_id,
      groupId: fixture.group_id,
      minutes: 60,
      bsdEventId: -888002,
    });

    await run(
      `INSERT INTO predictions (user_id, group_id, match_id, home_score, away_score)
       VALUES (?, ?, ?, 1, 0)`,
      [fixture.user_id, seeded.groupId, seeded.matchId]
    );

    const targets = await findPendingReminderTargets({
      userId: fixture.user_id,
      groupId: seeded.groupId,
      minutes: 60,
      windowMinutes: 10,
      matchId: seeded.matchId,
    });

    assert.equal(targets.length, 0);
  });

  it('ne marque pas le rappel comme envoyé si le push est ignoré (VAPID absent)', async () => {
    const fixture = await get(
      `SELECT u.id AS user_id, gm.group_id
       FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       LIMIT 1`
    );
    assert.ok(fixture, 'utilisateur avec groupe requis');

    const seeded = await seedTestReminderMatch({
      userId: fixture.user_id,
      groupId: fixture.group_id,
      minutes: 60,
      bsdEventId: -888002,
    });

    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const result = await sendPredictionReminders({
      userId: fixture.user_id,
      matchId: seeded.matchId,
      minutes: 60,
      windowMinutes: 10,
    });

    assert.ok(result.count >= 1);
    assert.ok(result.results.every(row => row.push?.skipped === true));

    const logged = await get(
      `SELECT id FROM notification_log WHERE user_id = ? AND match_id = ? AND type = 'prono_reminder'`,
      [fixture.user_id, seeded.matchId]
    );
    assert.equal(logged, null);
  });
});

describe('notifications — rappel matin', () => {
  before(async () => {
    await migrate();
    await cleanupTestReminderMatch(-888003);
  });

  after(async () => {
    await cleanupTestReminderMatch(-888003);
  });

  it('détecte les matchs du jour sans pronostic', async () => {
    const fixture = await get(
      `SELECT u.id AS user_id, gm.group_id
       FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       LIMIT 1`
    );
    assert.ok(fixture, 'utilisateur avec groupe requis');

    await cleanupTestReminderMatch(-888003);

    const seeded = await seedTestReminderMatch({
      userId: fixture.user_id,
      groupId: fixture.group_id,
      minutes: 300,
      bsdEventId: -888003,
      home: 'Matin FC',
      away: 'Aurore United',
    });

    const todayParis = getParisCalendarDay(new Date(seeded.kickoff));
    const targets = await findMorningReminderTargets({
      userId: fixture.user_id,
      groupId: fixture.group_id,
      day: todayParis,
      skipDedup: true,
    });

    assert.ok(targets.some(t => t.match_ids?.includes(seeded.matchId)));
    assert.ok(targets.find(t => t.group_id === fixture.group_id)?.pendingCount >= 1);
  });

  it('n\'envoie qu\'une fois le rappel matin par groupe', async () => {
    const fixture = await get(
      `SELECT u.id AS user_id, gm.group_id
       FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       LIMIT 1`
    );
    assert.ok(fixture);

    await cleanupTestReminderMatch(-888003);

    const seeded = await seedTestReminderMatch({
      userId: fixture.user_id,
      groupId: fixture.group_id,
      minutes: 300,
      bsdEventId: -888003,
    });

    await run(
      `INSERT INTO notification_log (user_id, match_id, type) VALUES (?, ?, 'prono_morning')`,
      [fixture.user_id, seeded.matchId]
    );

    const targets = await findMorningReminderTargets({
      userId: fixture.user_id,
      groupId: fixture.group_id,
      day: getParisCalendarDay(new Date(seeded.kickoff)),
    });

    assert.equal(targets.length, 0);
  });
});

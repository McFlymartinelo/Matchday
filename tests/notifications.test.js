import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, run, get, closeDb } from '../server/db/connection.js';
import {
  seedTestReminderMatch,
  findPendingReminderTargets,
  cleanupTestReminderMatch,
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
    const user = await get('SELECT id FROM users LIMIT 1');
    assert.ok(user, 'utilisateur test requis');

    const seeded = await seedTestReminderMatch({
      userId: user.id,
      minutes: 60,
      bsdEventId: -888002,
      home: 'Test FC',
      away: 'Demo United',
    });

    const targets = await findPendingReminderTargets({
      userId: user.id,
      minutes: 60,
      windowMinutes: 10,
    });

    assert.ok(targets.some(t => t.match_id === seeded.matchId));
    assert.equal(targets.find(t => t.match_id === seeded.matchId)?.home_team_name, 'Test FC');
  });

  it('ignore un match déjà pronostiqué', async () => {
    const user = await get('SELECT id FROM users LIMIT 1');
    const seeded = await seedTestReminderMatch({
      userId: user.id,
      minutes: 60,
      bsdEventId: -888002,
    });

    await run(
      `INSERT INTO predictions (user_id, group_id, match_id, home_score, away_score)
       VALUES (?, ?, ?, 1, 0)`,
      [user.id, seeded.groupId, seeded.matchId]
    );

    const targets = await findPendingReminderTargets({
      userId: user.id,
      minutes: 60,
      windowMinutes: 10,
      matchId: seeded.matchId,
    });

    assert.equal(targets.length, 0);
  });
});

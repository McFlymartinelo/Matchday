import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const EVENT_ID = -778001;

describe('autoRecalculateFinishedMatches', () => {
  before(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.TEST_DB_PATH = 'data/test-auto-recalculate.db';
  });

  after(async () => {
    const { run, closeDb } = await import('../server/db/connection.js');
    await run('DELETE FROM predictions WHERE match_id IN (SELECT id FROM matches WHERE bsd_event_id = ?)', [EVENT_ID]);
    await run('DELETE FROM matches WHERE bsd_event_id = ?', [EVENT_ID]);
    await run("DELETE FROM group_competitions WHERE group_id IN (SELECT id FROM groups WHERE invite_code = 'RECALC1')");
    await run("DELETE FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE invite_code = 'RECALC1')");
    await run("DELETE FROM groups WHERE invite_code = 'RECALC1'");
    await run("DELETE FROM users WHERE username IN ('recalc-exact', 'recalc-fresh')");
    await closeDb();
  });

  it('recalcule un score exact figé si le résultat BSD a changé (3-1 → 3-0)', async () => {
    const { migrate, run, get } = await import('../server/db/connection.js');
    const { seedCompetitions } = await import('../server/db/seed.js');
    const { autoRecalculateFinishedMatches } = await import('../server/services/sync.js');

    await migrate();
    await seedCompetitions();
    const comp = await get("SELECT id FROM competitions WHERE code = 'BL1'");

    await run('DELETE FROM predictions WHERE match_id IN (SELECT id FROM matches WHERE bsd_event_id = ?)', [EVENT_ID]);
    await run('DELETE FROM matches WHERE bsd_event_id = ?', [EVENT_ID]);
    await run("DELETE FROM group_competitions WHERE group_id IN (SELECT id FROM groups WHERE invite_code = 'RECALC1')");
    await run("DELETE FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE invite_code = 'RECALC1')");
    await run("DELETE FROM groups WHERE invite_code = 'RECALC1'");
    await run("DELETE FROM users WHERE username IN ('recalc-exact', 'recalc-fresh')");

    await run(`INSERT INTO users (username, password_hash, display_name) VALUES ('recalc-exact', 'x', 'Exact')`);
    await run(`INSERT INTO users (username, password_hash, display_name) VALUES ('recalc-fresh', 'x', 'Fresh')`);
    const exactUser = await get("SELECT id FROM users WHERE username = 'recalc-exact'");
    const freshUser = await get("SELECT id FROM users WHERE username = 'recalc-fresh'");

    await run(`INSERT INTO groups (name, invite_code, admin_id) VALUES ('recalc-test', 'RECALC1', ?)`, [exactUser.id]);
    const group = await get("SELECT id FROM groups WHERE invite_code = 'RECALC1'");
    await run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?), (?, ?)', [
      group.id, exactUser.id, group.id, freshUser.id,
    ]);
    await run('INSERT INTO group_competitions (group_id, competition_id) VALUES (?, ?)', [group.id, comp.id]);

    await run(
      `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name,
         home_score, away_score, status, matchday, kickoff_at, season)
       VALUES (?, ?, 'RB Leipzig', 'Borussia M''gladbach', 3, 0, 'finished', 2, '2026-08-30T13:30:00Z', '2026-2027')`,
      [EVENT_ID, comp.id]
    );
    const match = await get('SELECT id FROM matches WHERE bsd_event_id = ?', [EVENT_ID]);

    await run(
      `INSERT INTO predictions (user_id, group_id, match_id, home_score, away_score, points, points_detail)
       VALUES (?, ?, ?, 3, 1, 3, 'exact')`,
      [exactUser.id, group.id, match.id]
    );
    await run(
      `INSERT INTO predictions (user_id, group_id, match_id, home_score, away_score)
       VALUES (?, ?, ?, 2, 0)`,
      [freshUser.id, group.id, match.id]
    );

    const updated = await autoRecalculateFinishedMatches();
    assert.ok(updated >= 2);

    const stale = await get(
      'SELECT points, points_detail FROM predictions WHERE user_id = ? AND match_id = ?',
      [exactUser.id, match.id]
    );
    assert.equal(stale.points, 1);
    assert.equal(stale.points_detail, 'winner');

    const fresh = await get(
      'SELECT points, points_detail FROM predictions WHERE user_id = ? AND match_id = ?',
      [freshUser.id, match.id]
    );
    assert.equal(fresh.points, 1);
    assert.equal(fresh.points_detail, 'winner');
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildFixtureKey, dedupeMatches, isRicherMatch } from '../server/lib/matches.js';

describe('dedupeMatches', () => {
  it('fusionne deux lignes identiques (bsd_event_id différent)', () => {
    const kickoff = '2026-08-22T17:00:00.000Z';
    const rows = dedupeMatches([
      {
        id: 10,
        competition_id: 3,
        matchday: 1,
        home_team_name: 'Celta Vigo',
        away_team_name: 'Osasuna',
        home_bsd_team_id: 101,
        away_bsd_team_id: 102,
        kickoff_at: kickoff,
        bsd_event_id: 9001,
      },
      {
        id: 11,
        competition_id: 3,
        matchday: 1,
        home_team_name: 'Celta Vigo',
        away_team_name: 'Osasuna',
        home_bsd_team_id: 101,
        away_bsd_team_id: 102,
        kickoff_at: kickoff,
        bsd_event_id: 9002,
        prediction: { home_score: 1, away_score: 0 },
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 11);
    assert.ok(rows[0].prediction);
  });

  it('fusionne même affiche avec kickoff différent', () => {
    const rows = dedupeMatches([
      {
        id: 20,
        competition_id: 3,
        matchday: 1,
        home_team_name: 'Celta Vigo',
        away_team_name: 'Osasuna',
        home_bsd_team_id: 101,
        away_bsd_team_id: 102,
        kickoff_at: '2026-08-22T17:00:00.000Z',
      },
      {
        id: 21,
        competition_id: 3,
        matchday: 1,
        home_team_name: 'Celta Vigo',
        away_team_name: 'Osasuna',
        home_bsd_team_id: 101,
        away_bsd_team_id: 102,
        kickoff_at: '2026-08-22T17:30:00.000Z',
      },
    ]);

    assert.equal(rows.length, 1);
  });

  it('conserve deux affiches différentes', () => {
    const rows = dedupeMatches([
      {
        id: 1,
        competition_id: 3,
        matchday: 1,
        home_team_name: 'Celta Vigo',
        away_team_name: 'Osasuna',
        home_bsd_team_id: 101,
        away_bsd_team_id: 102,
        kickoff_at: '2026-08-22T17:00:00.000Z',
      },
      {
        id: 2,
        competition_id: 3,
        matchday: 2,
        home_team_name: 'Osasuna',
        away_team_name: 'Celta Vigo',
        home_bsd_team_id: 102,
        away_bsd_team_id: 101,
        kickoff_at: '2026-01-10T17:00:00.000Z',
      },
    ]);

    assert.equal(rows.length, 2);
    assert.notEqual(buildFixtureKey(rows[0]), buildFixtureKey(rows[1]));
  });

  it('préfère le match joué au reporté et conserve le pronostic', () => {
    const rows = dedupeMatches([
      {
        id: 30,
        competition_id: 3,
        matchday: 1,
        home_team_name: 'Celta Vigo',
        away_team_name: 'Osasuna',
        home_bsd_team_id: 49,
        away_bsd_team_id: 58,
        kickoff_at: '2026-08-16T19:30:00.000Z',
        bsd_event_id: 213521,
        status: 'postponed',
        home_score: null,
        away_score: null,
        prediction: { home_score: 2, away_score: 1 },
      },
      {
        id: 31,
        competition_id: 3,
        matchday: 1,
        home_team_name: 'Celta Vigo',
        away_team_name: 'Osasuna',
        home_bsd_team_id: 49,
        away_bsd_team_id: 58,
        kickoff_at: '2026-08-27T18:30:00.000Z',
        bsd_event_id: 587840,
        status: 'finished',
        home_score: 1,
        away_score: 2,
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'finished');
    assert.equal(rows[0].home_score, 1);
    assert.equal(rows[0].away_score, 2);
    assert.equal(rows[0].bsd_event_id, 587840);
    assert.deepEqual(rows[0].prediction, { home_score: 2, away_score: 1 });
  });
});

describe('isRicherMatch', () => {
  it('considère un score terminé plus riche qu’un report', () => {
    const postponed = { status: 'postponed', home_score: null, away_score: null, kickoff_at: '2026-08-16T19:30:00Z', bsd_event_id: 1 };
    const finished = { status: 'finished', home_score: 1, away_score: 2, kickoff_at: '2026-08-27T18:30:00Z', bsd_event_id: 2 };
    assert.equal(isRicherMatch(finished, postponed), true);
    assert.equal(isRicherMatch(postponed, finished), false);
  });
});

describe('dedupeCompetitionMatches — report remplacé', () => {
  const OLD_EVENT = -776010;
  const NEW_EVENT = -776011;

  before(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.TEST_DB_PATH = 'data/test-matches-dedupe.db';
  });

  after(async () => {
    const { run, closeDb } = await import('../server/db/connection.js');
    await run('DELETE FROM predictions WHERE match_id IN (SELECT id FROM matches WHERE bsd_event_id IN (?, ?))', [OLD_EVENT, NEW_EVENT]);
    await run('DELETE FROM matches WHERE bsd_event_id IN (?, ?)', [OLD_EVENT, NEW_EVENT]);
    await closeDb();
  });

  it('copie score et date du replay sur le match reporté', async () => {
    const { migrate, run, get } = await import('../server/db/connection.js');
    const { seedCompetitions } = await import('../server/db/seed.js');
    const { dedupeCompetitionMatches } = await import('../server/lib/matches.js');
    await migrate();
    await seedCompetitions();
    const comp = await get("SELECT id FROM competitions WHERE code = 'PD'");

    await run('DELETE FROM predictions WHERE match_id IN (SELECT id FROM matches WHERE bsd_event_id IN (?, ?))', [OLD_EVENT, NEW_EVENT]);
    await run('DELETE FROM matches WHERE bsd_event_id IN (?, ?)', [OLD_EVENT, NEW_EVENT]);
    await run("DELETE FROM groups WHERE invite_code = 'DEDUP1'");
    await run("DELETE FROM users WHERE username = 'dedupe-user'");

    await run(
      `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name,
         home_bsd_team_id, away_bsd_team_id, home_score, away_score, status, matchday, kickoff_at, season)
       VALUES (?, ?, 'Celta Vigo', 'Osasuna', 49, 58, NULL, NULL, 'postponed', 1, '2026-08-16T19:30:00+00:00', '2026-2027')`,
      [OLD_EVENT, comp.id]
    );
    const postponed = await get('SELECT id FROM matches WHERE bsd_event_id = ?', [OLD_EVENT]);

    await run(`INSERT INTO users (username, password_hash, display_name) VALUES ('dedupe-user', 'x', 'Dedupe')`);
    const user = await get("SELECT id FROM users WHERE username = 'dedupe-user'");
    await run(`INSERT INTO groups (name, invite_code, admin_id) VALUES ('dedupe-test', 'DEDUP1', ?)`, [user.id]);
    const group = await get("SELECT id FROM groups WHERE invite_code = 'DEDUP1'");
    await run(
      `INSERT INTO predictions (user_id, group_id, match_id, home_score, away_score) VALUES (?, ?, ?, 2, 1)`,
      [user.id, group.id, postponed.id]
    );

    await run(
      `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name,
         home_bsd_team_id, away_bsd_team_id, home_score, away_score, status, matchday, kickoff_at, season)
       VALUES (?, ?, 'Celta Vigo', 'Osasuna', 49, 58, 1, 2, 'finished', 1, '2026-08-27T18:30:00+00:00', '2026-2027')`,
      [NEW_EVENT, comp.id]
    );

    const merged = await dedupeCompetitionMatches(comp.id);
    assert.ok(merged >= 1);

    const kept = await get('SELECT * FROM matches WHERE id = ?', [postponed.id]);
    assert.equal(kept.status, 'finished');
    assert.equal(kept.home_score, 1);
    assert.equal(kept.away_score, 2);
    assert.equal(kept.bsd_event_id, NEW_EVENT);
    assert.equal(kept.kickoff_at, '2026-08-27T18:30:00+00:00');

    const dropped = await get('SELECT id FROM matches WHERE bsd_event_id = ?', [OLD_EVENT]);
    assert.equal(dropped, null);

    const pred = await get('SELECT home_score, away_score FROM predictions WHERE match_id = ?', [postponed.id]);
    assert.equal(pred.home_score, 2);
    assert.equal(pred.away_score, 1);

    await run('DELETE FROM predictions WHERE match_id = ?', [postponed.id]);
    await run('DELETE FROM groups WHERE id = ?', [group.id]);
    await run('DELETE FROM users WHERE id = ?', [user.id]);
  });
});

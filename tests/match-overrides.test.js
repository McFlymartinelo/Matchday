import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { applyVenueOverride, shouldInvertPsgRennes } from '../server/lib/matchOverrides.js';

const j1 = {
  home_team_name: 'Paris SG',
  away_team_name: 'Stade Rennais',
  matchday: 1,
  kickoff_at: '2026-08-23T18:45:00.000Z',
  home_bsd_team_id: 10,
  away_bsd_team_id: 20,
  home_score: 2,
  away_score: 1,
};

describe('shouldInvertPsgRennes', () => {
  it('inverse le J1 PSG à domicile vs Rennes', () => {
    assert.equal(shouldInvertPsgRennes(j1), true);
    assert.equal(shouldInvertPsgRennes({ ...j1, home_team_name: 'Paris Saint-Germain' }), true);
    assert.equal(shouldInvertPsgRennes({ ...j1, home_team_name: 'PSG', away_team_name: 'Rennes' }), true);
  });

  it('n’inverse pas si Rennes est déjà à domicile', () => {
    assert.equal(shouldInvertPsgRennes({
      ...j1,
      home_team_name: 'Stade Rennais',
      away_team_name: 'Paris SG',
    }), false);
  });

  it('n’inverse pas le match retour (mars)', () => {
    assert.equal(shouldInvertPsgRennes({
      home_team_name: 'Paris SG',
      away_team_name: 'Rennes',
      matchday: 23,
      kickoff_at: '2027-03-07T19:00:00.000Z',
    }), false);
  });
});

describe('applyVenueOverride', () => {
  it('permute équipes, ids BSD et scores', () => {
    const out = applyVenueOverride(j1);
    assert.equal(out.home_team_name, 'Stade Rennais');
    assert.equal(out.away_team_name, 'Paris SG');
    assert.equal(out.home_bsd_team_id, 20);
    assert.equal(out.away_bsd_team_id, 10);
    assert.equal(out.home_score, 1);
    assert.equal(out.away_score, 2);
  });

  it('laisse intact un autre match', () => {
    const other = { home_team_name: 'Lyon', away_team_name: 'Monaco', matchday: 1 };
    assert.equal(applyVenueOverride(other), other);
  });
});

describe('invertPersistedVenueOverrides', () => {
  const EVENT_ID = -776001;

  before(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.TEST_DB_PATH = 'data/test-match-overrides.db';
  });

  after(async () => {
    const { run, closeDb } = await import('../server/db/connection.js');
    await run('DELETE FROM predictions WHERE match_id IN (SELECT id FROM matches WHERE bsd_event_id = ?)', [EVENT_ID]);
    await run('DELETE FROM matches WHERE bsd_event_id = ?', [EVENT_ID]);
    await closeDb();
  });

  it('permute le match en base et les pronostics', async () => {
    const { migrate, run, get } = await import('../server/db/connection.js');
    const { seedCompetitions } = await import('../server/db/seed.js');
    const { invertPersistedVenueOverrides } = await import('../server/lib/matchOverrides.js');
    await migrate();
    await seedCompetitions();
    const comp = await get("SELECT id FROM competitions WHERE code = 'L1'");

    await run('DELETE FROM predictions WHERE match_id IN (SELECT id FROM matches WHERE bsd_event_id = ?)', [EVENT_ID]);
    await run('DELETE FROM matches WHERE bsd_event_id = ?', [EVENT_ID]);

    await run(
      `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name,
         home_bsd_team_id, away_bsd_team_id, home_score, away_score, status, matchday, kickoff_at, season)
       VALUES (?, ?, 'Paris SG', 'Stade Rennais', 10, 20, NULL, NULL, 'scheduled', 1, '2026-08-23T18:45:00.000Z', '2026-2027')`,
      [EVENT_ID, comp.id]
    );
    const match = await get('SELECT id FROM matches WHERE bsd_event_id = ?', [EVENT_ID]);
    const user = await get('SELECT id FROM users LIMIT 1');
    const group = await get('SELECT id FROM groups LIMIT 1');
    if (user && group) {
      await run(
        `INSERT INTO predictions (user_id, group_id, match_id, home_score, away_score)
         VALUES (?, ?, ?, 3, 1)`,
        [user.id, group.id, match.id]
      );
    }

    const inverted = await invertPersistedVenueOverrides();
    assert.equal(inverted, 1);

    const updated = await get('SELECT home_team_name, away_team_name, home_bsd_team_id, away_bsd_team_id FROM matches WHERE id = ?', [match.id]);
    assert.equal(updated.home_team_name, 'Stade Rennais');
    assert.equal(updated.away_team_name, 'Paris SG');
    assert.equal(updated.home_bsd_team_id, 20);
    assert.equal(updated.away_bsd_team_id, 10);

    if (user && group) {
      const pred = await get('SELECT home_score, away_score FROM predictions WHERE match_id = ?', [match.id]);
      assert.equal(pred.home_score, 1);
      assert.equal(pred.away_score, 3);
    }

    assert.equal(await invertPersistedVenueOverrides(), 0);
  });
});

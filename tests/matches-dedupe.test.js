import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFixtureKey, dedupeMatches } from '../server/lib/matches.js';

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
});

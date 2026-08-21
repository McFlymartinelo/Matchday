import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractStandingsRows,
  normalizeStandingRow,
  findSeasonIdForLabel,
} from '../server/services/bsd.js';

describe('extractStandingsRows', () => {
  it('lit le tableau plat `standings`', () => {
    const rows = extractStandingsRows({
      standings: [{ position: 1, team_name: 'PSG', pts: 6 }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].team_name, 'PSG');
  });

  it('aplatit un payload groupé (map)', () => {
    const rows = extractStandingsRows({
      grouped: true,
      groups: {
        'Group A': [{ position: 1, team_name: 'A1' }],
        'Group B': [{ position: 1, team_name: 'B1' }],
      },
    });
    assert.equal(rows.length, 2);
  });
});

describe('normalizeStandingRow', () => {
  it('mappe `pts` BSD vers points', () => {
    const row = normalizeStandingRow({
      position: 1, team_name: 'Sporting CP', pts: 82, played: 34, won: 25, drawn: 7, lost: 2,
      goals_for: 70, goals_against: 20,
    });
    assert.equal(row.points, 82);
    assert.equal(row.played, 34);
    assert.equal(row.team_name, 'Sporting CP');
  });

  it('reprend la zone UEFA BSD', () => {
    const row = normalizeStandingRow({
      position: 1,
      team_name: 'Sporting CP',
      pts: 82,
      zone: { key: 'cl', label: 'Champions League', type: 'qualification' },
    });
    assert.equal(row.zone_key, 'cl');
    assert.equal(row.zone_label, 'Champions League');
  });

  it('ignore une ligne sans nom d’équipe', () => {
    assert.equal(normalizeStandingRow({ position: 1, pts: 10 }), null);
  });
});

describe('findSeasonIdForLabel', () => {
  const seasons = {
    results: [
      { id: 100, name: 'Ligue 1 25/26', year: 2025, is_current: true },
      { id: 200, name: 'Ligue 1 26/27', year: 2026, is_current: false },
    ],
  };

  it('prend la saison 26/27 même si BSD current_season est encore 25/26', () => {
    assert.equal(findSeasonIdForLabel(seasons, '2026-2027'), 200);
  });

  it('prend la saison 25/26 si c’est la saison active Matchday', () => {
    assert.equal(findSeasonIdForLabel(seasons, '2025-2026'), 100);
  });
});

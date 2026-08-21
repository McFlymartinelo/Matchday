import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  zoneBucket,
  applyZonesToRows,
  defaultEuropeanZones,
} from '../server/lib/standingZones.js';

describe('zoneBucket', () => {
  it('classe LDC / Europa / Conférence / relégation', () => {
    assert.equal(zoneBucket('cl'), 'cl');
    assert.equal(zoneBucket('clq'), 'cl');
    assert.equal(zoneBucket('el'), 'el');
    assert.equal(zoneBucket('uecl'), 'ecl');
    assert.equal(zoneBucket('relq'), 'relq');
    assert.equal(zoneBucket('rel'), 'rel');
  });
});

describe('applyZonesToRows', () => {
  it('reprend zone sur la ligne BSD puis complète via la légende', () => {
    const rows = applyZonesToRows(
      [
        { position: 1, team_name: 'PSG', zone_key: 'cl', zone_label: 'Champions League' },
        { position: 5, team_name: 'Nice' },
        { position: 6, team_name: 'Rennes' },
      ],
      [
        { key: 'el', label: 'Europa League', type: 'qualification', from: 5, to: 5 },
        { key: 'uecl', label: 'Conference League Qualification', type: 'qualification', from: 6, to: 6 },
      ]
    );
    assert.equal(rows[0].zone_key, 'cl');
    assert.equal(rows[1].zone_key, 'el');
    assert.equal(rows[2].zone_key, 'uecl');
    assert.equal(zoneBucket(rows[2].zone_key), 'ecl');
  });
});

describe('defaultEuropeanZones', () => {
  it('place LDC / Europa / Conférence en Ligue 1', () => {
    const zones = defaultEuropeanZones('L1', 18);
    assert.equal(zones.find(z => z.key === 'cl').to, 3);
    assert.equal(zones.find(z => z.key === 'el').from, 5);
    assert.equal(zones.find(z => z.key === 'uecl').from, 6);
  });
});

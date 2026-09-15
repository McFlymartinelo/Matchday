import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCupCompetition,
  isChampionBetOpen,
  isLeaguePhaseMatch,
  isChampionsLeagueMainEvent,
  pickBsdLeague,
  BSD_LEAGUE_MAPPING,
  CHAMPION_BETS_DEADLINE,
  LDC_CHAMPION_BETS_DEADLINE,
} from '../server/lib/competitions.js';

describe('competitions helpers', () => {
  it('identifie la LDC comme coupe', () => {
    assert.equal(isCupCompetition('LDC'), true);
    assert.equal(isCupCompetition('L1'), false);
  });

  it('garde les pronos vainqueur LDC ouverts après le 4 septembre', () => {
    const afterDomestic = new Date('2026-09-06T12:00:00');
    assert.equal(isChampionBetOpen('L1', { now: afterDomestic }), false);
    assert.equal(isChampionBetOpen('LDC', { now: afterDomestic }), true);
    assert.equal(isChampionBetOpen('LDC', { now: new Date('2026-09-08T18:00:00') }), false);
    assert.ok(CHAMPION_BETS_DEADLINE < LDC_CHAMPION_BETS_DEADLINE);
  });

  it('ne compte que la phase de ligue LDC pour le classement', () => {
    assert.equal(isLeaguePhaseMatch('LDC', 1, '2026-09-16T19:00:00Z', '2026-2027'), true);
    assert.equal(isLeaguePhaseMatch('LDC', 8, '2027-01-28T20:00:00Z', '2026-2027'), true);
    assert.equal(isLeaguePhaseMatch('LDC', 9, '2027-02-17T20:00:00Z', '2026-2027'), false);
    assert.equal(isLeaguePhaseMatch('LDC', 1, '2026-08-12T19:00:00Z', '2026-2027'), false);
    assert.equal(isLeaguePhaseMatch('L1', 34, '2027-05-01T19:00:00Z', '2026-2027'), true);
  });

  it('exclut les tours préliminaires d’été de la LDC', () => {
    assert.equal(isChampionsLeagueMainEvent('LDC', 'Qualification Round 1', '2026-07-07T16:00:00Z', '2026-2027'), false);
    assert.equal(isChampionsLeagueMainEvent('LDC', 'League Phase', '2026-09-16T19:00:00Z', '2026-2027'), true);
    assert.equal(isChampionsLeagueMainEvent('LDC', 'Play-offs', '2027-02-17T20:00:00Z', '2026-2027'), true);
    assert.equal(isChampionsLeagueMainEvent('L1', 'Journée 1', '2026-08-15T19:00:00Z', '2026-2027'), true);
  });

  it('associe la ligue BSD UEFA Champions League à LDC', () => {
    const leagues = [
      { id: 10, name: 'AFC Champions League', country: 'Asia', is_women: false },
      { id: 20, name: 'UEFA Champions League', country: 'Europe', is_women: false },
      { id: 21, name: 'UEFA Champions League Women', country: 'Europe', is_women: true },
    ];
    const found = pickBsdLeague(leagues, BSD_LEAGUE_MAPPING.LDC);
    assert.equal(found?.id, 20);
  });

  it('prend la Bundesliga 1 et ignore la 2. Bundesliga', () => {
    const leagues = [
      { id: 2, name: '2. Bundesliga', country: 'Germany', is_women: false },
      { id: 1, name: 'Bundesliga', country: 'Germany', is_women: false },
      { id: 3, name: '3. Liga', country: 'Germany', is_women: false },
      { id: 4, name: 'DFB-Pokal', country: 'Germany', is_women: false },
    ];
    const found = pickBsdLeague(leagues, BSD_LEAGUE_MAPPING.BL1);
    assert.equal(found?.id, 1);
  });

  it('ne retombe pas sur la 2. Bundesliga si la D1 est absente', () => {
    const leagues = [
      { id: 2, name: '2. Bundesliga', country: 'Germany', is_women: false },
    ];
    assert.equal(pickBsdLeague(leagues, BSD_LEAGUE_MAPPING.BL1), null);
  });
});

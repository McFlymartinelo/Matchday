import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundKey,
  matchdayKey,
  buildPointsByRound,
  buildPointsByMatchday,
  accumulateHistory,
} from '../server/lib/rankingHistory.js';

describe('roundKey', () => {
  it('normalise number et string', () => {
    assert.equal(roundKey(1, 5), '1:5');
    assert.equal(roundKey('1', '5'), '1:5');
  });
});

describe('buildPointsByRound', () => {
  it('additionne le bonus Mon 11 aux points de pronos', () => {
    const map = buildPointsByRound(
      [{ competition_id: 1, matchday: 2, user_id: 10, points: 6, exact_count: 2, diff_count: 0, winner_count: 0 }],
      [{ competition_id: 1, matchday: 2, user_id: 10, points: 4 }],
    );
    const row = map.get('1:2').get(10);
    assert.equal(row.predPoints, 6);
    assert.equal(row.fullPoints, 10);
    assert.equal(row.exactCount, 2);
  });

  it('crée une entrée XI même sans prono', () => {
    const map = buildPointsByRound(
      [],
      [{ competition_id: 2, matchday: 1, user_id: 3, points: 5 }],
    );
    assert.equal(map.get('2:1').get(3).fullPoints, 5);
    assert.equal(map.get('2:1').get(3).predPoints, 0);
  });
});

describe('accumulateHistory', () => {
  const participants = [
    { userId: 1, displayName: 'Alex' },
    { userId: 2, displayName: 'Léa' },
    { userId: 3, displayName: 'Nico' },
  ];
  const rounds = [
    { competitionId: 1, matchday: 1, compCode: 'L1' },
    { competitionId: 1, matchday: 2, compCode: 'L1' },
  ];

  it('cumule les points et inverse le rang après J2', () => {
    const pointsByRound = buildPointsByRound(
      [
        { competition_id: 1, matchday: 1, user_id: 1, points: 6, exact_count: 2, diff_count: 0, winner_count: 0 },
        { competition_id: 1, matchday: 1, user_id: 2, points: 3, exact_count: 1, diff_count: 0, winner_count: 0 },
        { competition_id: 1, matchday: 2, user_id: 1, points: 0, exact_count: 0, diff_count: 0, winner_count: 0 },
        { competition_id: 1, matchday: 2, user_id: 2, points: 9, exact_count: 3, diff_count: 0, winner_count: 0 },
      ],
      [],
    );
    const history = accumulateHistory(participants, rounds, pointsByRound);

    assert.equal(history.length, 2);
    assert.equal(history[0].label, 'L1 · J1');
    const j1Alex = history[0].rankings.find(r => r.userId === 1);
    const j1Lea = history[0].rankings.find(r => r.userId === 2);
    assert.equal(j1Alex.rank, 1);
    assert.equal(j1Alex.cumulativePoints, 6);
    assert.equal(j1Alex.roundPoints, 6);
    assert.equal(j1Lea.rank, 2);

    const j2Alex = history[1].rankings.find(r => r.userId === 1);
    const j2Lea = history[1].rankings.find(r => r.userId === 2);
    assert.equal(j2Lea.rank, 1);
    assert.equal(j2Lea.cumulativePoints, 12);
    assert.equal(j2Lea.roundPoints, 9);
    assert.equal(j2Alex.rank, 2);
    assert.equal(j2Alex.cumulativePoints, 6);
    assert.equal(j2Alex.roundPoints, 0);
  });

  it('garde un joueur à 0 pt dans le classement', () => {
    const pointsByRound = buildPointsByRound(
      [{ competition_id: 1, matchday: 1, user_id: 1, points: 3, exact_count: 1, diff_count: 0, winner_count: 0 }],
      [],
    );
    const history = accumulateHistory(participants, [rounds[0]], pointsByRound);
    const nico = history[0].rankings.find(r => r.userId === 3);
    assert.equal(nico.roundPoints, 0);
    assert.equal(nico.cumulativePoints, 0);
    assert.equal(nico.rank, 3);
  });

  it('départage à points égaux par les exacts', () => {
    const pointsByRound = buildPointsByRound(
      [
        { competition_id: 1, matchday: 1, user_id: 1, points: 6, exact_count: 1, diff_count: 1, winner_count: 1 },
        { competition_id: 1, matchday: 1, user_id: 2, points: 6, exact_count: 2, diff_count: 0, winner_count: 0 },
      ],
      [],
    );
    const history = accumulateHistory(participants, [rounds[0]], pointsByRound);
    assert.equal(history[0].rankings[0].userId, 2);
    assert.equal(history[0].rankings[0].rank, 1);
  });

  it('fusionne plusieurs championnats sur une même journée globale', () => {
    const globalRounds = [
      { matchday: 1, label: 'J1', key: matchdayKey(1) },
      { matchday: 2, label: 'J2', key: matchdayKey(2) },
    ];
    const pointsByRound = buildPointsByMatchday(
      [
        { matchday: 1, user_id: 1, points: 3, exact_count: 1, diff_count: 0, winner_count: 0 },
        { matchday: 1, user_id: 1, points: 6, exact_count: 2, diff_count: 0, winner_count: 0 },
        { matchday: 1, user_id: 2, points: 3, exact_count: 1, diff_count: 0, winner_count: 0 },
        { matchday: 2, user_id: 2, points: 9, exact_count: 3, diff_count: 0, winner_count: 0 },
      ],
      [],
    );
    const history = accumulateHistory(participants, globalRounds, pointsByRound);

    assert.equal(history[0].label, 'J1');
    assert.equal(history[1].label, 'J2');
    const j1Alex = history[0].rankings.find(r => r.userId === 1);
    assert.equal(j1Alex.roundPoints, 9);
    assert.equal(j1Alex.rank, 1);
    const j2Alex = history[1].rankings.find(r => r.userId === 1);
    const j2Lea = history[1].rankings.find(r => r.userId === 2);
    assert.equal(j2Alex.cumulativePoints, 9);
    assert.equal(j2Lea.cumulativePoints, 12);
    assert.equal(j2Lea.rank, 1);
  });
});

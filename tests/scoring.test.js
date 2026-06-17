import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scorePrediction,
  validateSeasonXiPlayers,
  computeMatchdayXi,
  computeSeasonXiBonus,
  scoreSpecialBet,
  filterMatchesByGroupCompetitions,
} from '../server/lib/scoring.js';

describe('scorePrediction', () => {
  const scoring = { exact: 3, diff: 2, winner: 1 };

  it('attribue 3 pts pour un score exact', () => {
    const r = scorePrediction(2, 1, 2, 1, scoring);
    assert.equal(r.points, 3);
    assert.equal(r.detail, 'exact');
  });

  it('attribue 2 pts pour bon écart + vainqueur', () => {
    const r = scorePrediction(3, 1, 2, 0, scoring);
    assert.equal(r.points, 2);
    assert.equal(r.detail, 'diff');
  });

  it('attribue 1 pt pour bon vainqueur seulement', () => {
    const r = scorePrediction(3, 0, 1, 0, scoring);
    assert.equal(r.points, 1);
    assert.equal(r.detail, 'winner');
  });

  it('attribue 0 pt si raté', () => {
    const r = scorePrediction(0, 0, 2, 1, scoring);
    assert.equal(r.points, 0);
    assert.equal(r.detail, 'miss');
  });

  it('respecte un barème configurable', () => {
    const custom = { exact: 5, diff: 3, winner: 1 };
    assert.equal(scorePrediction(1, 0, 1, 0, custom).points, 5);
  });
});

describe('validateSeasonXiPlayers', () => {
  it('refuse deux joueurs du même club', () => {
    const players = [
      { team_id: 1, team_name: 'PSG', position: 'GK' },
      { team_id: 1, team_name: 'PSG', position: 'DEF' },
    ];
    const r = validateSeasonXiPlayers(players);
    assert.equal(r.valid, false);
    assert.match(r.error, /club/i);
  });

  it('accepte 11 joueurs de clubs différents avec gardien', () => {
    const players = Array.from({ length: 11 }, (_, i) => ({
      team_id: i + 1,
      team_name: `Club${i}`,
      position: i === 0 ? 'GK' : 'DEF',
    }));
    assert.equal(validateSeasonXiPlayers(players).valid, true);
  });

  it('refuse 11 joueurs sans gardien', () => {
    const players = Array.from({ length: 11 }, (_, i) => ({
      team_id: i + 1,
      team_name: `Club${i}`,
      position: 'DEF',
    }));
    assert.equal(validateSeasonXiPlayers(players).valid, false);
  });
});

describe('computeMatchdayXi', () => {
  it('sélectionne les meilleurs par poste en formation 1-4-3-3', () => {
    const stats = [
      { player_id: 1, player_name: 'GK1', position: 'GK', rating: 8.0, minutes: 90, goals: 0, assists: 0 },
      { player_id: 2, player_name: 'GK2', position: 'GK', rating: 6.0, minutes: 90, goals: 0, assists: 0 },
      { player_id: 10, player_name: 'DEF1', position: 'DEF', rating: 7.5, minutes: 90, goals: 0, assists: 0 },
      { player_id: 11, player_name: 'DEF2', position: 'DEF', rating: 7.0, minutes: 90, goals: 0, assists: 0 },
      { player_id: 12, player_name: 'DEF3', position: 'DEF', rating: 6.5, minutes: 90, goals: 0, assists: 0 },
      { player_id: 13, player_name: 'DEF4', position: 'DEF', rating: 6.0, minutes: 90, goals: 0, assists: 0 },
      { player_id: 14, player_name: 'DEF5', position: 'DEF', rating: 5.5, minutes: 90, goals: 0, assists: 0 },
      { player_id: 20, player_name: 'MID1', position: 'MID', rating: 8.5, minutes: 90, goals: 1, assists: 1 },
      { player_id: 21, player_name: 'MID2', position: 'MID', rating: 7.0, minutes: 90, goals: 0, assists: 1 },
      { player_id: 22, player_name: 'MID3', position: 'MID', rating: 6.5, minutes: 90, goals: 0, assists: 0 },
      { player_id: 30, player_name: 'FWD1', position: 'FWD', rating: 9.0, minutes: 90, goals: 2, assists: 0 },
      { player_id: 31, player_name: 'FWD2', position: 'FWD', rating: 7.5, minutes: 90, goals: 1, assists: 0 },
      { player_id: 32, player_name: 'FWD3', position: 'FWD', rating: 7.0, minutes: 90, goals: 0, assists: 0 },
    ];

    const xi = computeMatchdayXi(stats);
    assert.equal(xi.length, 11);
    assert.ok(xi.find(p => p.player_id === 1));
    assert.ok(!xi.find(p => p.player_id === 2));
    assert.ok(xi.find(p => p.player_id === 30));
    assert.ok(!xi.find(p => p.player_id === 14));
  });

  it('départage à égalité de rating par buts + assists', () => {
    const stats = [
      { player_id: 1, player_name: 'A', position: 'FWD', rating: 7.0, minutes: 90, goals: 0, assists: 0 },
      { player_id: 2, player_name: 'B', position: 'FWD', rating: 7.0, minutes: 90, goals: 2, assists: 1 },
      { player_id: 3, player_name: 'C', position: 'FWD', rating: 7.0, minutes: 90, goals: 1, assists: 0 },
    ];
    const xi = computeMatchdayXi(stats, { GK: 0, DEF: 0, MID: 0, FWD: 2 });
    assert.equal(xi[0].player_id, 2);
  });

  it('exclut les joueurs avec moins de 45 min', () => {
    const stats = [
      { player_id: 1, player_name: 'Sub', position: 'FWD', rating: 9.9, minutes: 20, goals: 2, assists: 0 },
    ];
    assert.equal(computeMatchdayXi(stats).length, 0);
  });
});

describe('computeSeasonXiBonus', () => {
  it('compte les joueurs présents dans le 11 type', () => {
    const r = computeSeasonXiBonus([1, 2, 3, 99], [2, 3, 4]);
    assert.equal(r.points, 2);
    assert.deepEqual(r.matchingPlayerIds, [2, 3]);
  });
});

describe('scoreSpecialBet', () => {
  it('attribue 5 pts pour le vainqueur du championnat', () => {
    assert.equal(scoreSpecialBet('champion', 'PSG', 'PSG'), 5);
    assert.equal(scoreSpecialBet('champion', 'PSG', 'Monaco'), 0);
  });

  it('attribue 3 pts pour le meilleur buteur', () => {
    assert.equal(scoreSpecialBet('top_scorer', 'Mbappé', 'Mbappé'), 3);
  });

  it('attribue 1 pt pour les places qualificatives', () => {
    assert.equal(scoreSpecialBet('champions_league', 'Lyon', 'Lyon'), 1);
    assert.equal(scoreSpecialBet('relegation', 'Metz', 'Metz'), 1);
  });
});

describe('filterMatchesByGroupCompetitions', () => {
  it('filtre côté serveur par championnats du groupe', () => {
    const matches = [
      { id: 1, competition_id: 1 },
      { id: 2, competition_id: 2 },
      { id: 3, competition_id: 3 },
    ];
    const filtered = filterMatchesByGroupCompetitions(matches, [1, 3]);
    assert.equal(filtered.length, 2);
    assert.deepEqual(filtered.map(m => m.id), [1, 3]);
  });
});

describe('filterMatchesByGroupCompetitions — intégration DB', () => {
  it('ne retourne que les matchs des championnats cochés', async () => {
    process.env.TEST_DB_PATH = 'data/test-scoring.db';
    const { migrate, run, all, closeDb } = await import('../server/db/connection.js');
    const { seedCompetitions } = await import('../server/db/seed.js');
    await migrate();
    await seedCompetitions();
    await run('DELETE FROM matches');

    await run(`INSERT INTO matches (competition_id, home_team_name, away_team_name, kickoff_at) VALUES (1, 'A', 'B', datetime('now'))`);
    await run(`INSERT INTO matches (competition_id, home_team_name, away_team_name, kickoff_at) VALUES (2, 'C', 'D', datetime('now'))`);

    const allMatches = await all('SELECT * FROM matches');
    const filtered = filterMatchesByGroupCompetitions(allMatches, [1]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].competition_id, 1);
    await closeDb();
  });
});

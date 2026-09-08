import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shortTeamCode,
  formResult,
  matchSide,
  lastFiveForm,
  attachFormToStandings,
  teamMatchKey,
} from '../server/lib/teamForm.js';

describe('shortTeamCode', () => {
  it('prend les initiales de plusieurs mots', () => {
    assert.equal(shortTeamCode('Paris SG'), 'PSG');
    assert.equal(shortTeamCode('Paris Saint-Germain'), 'PSG');
    assert.equal(shortTeamCode('Le Havre'), 'LH');
  });

  it('tronque un nom simple à 3 lettres', () => {
    assert.equal(shortTeamCode('Marseille'), 'MAR');
    assert.equal(shortTeamCode('Angers'), 'ANG');
  });
});

describe('formResult', () => {
  it('classe victoire / nul / défaite', () => {
    assert.equal(formResult(2, 0), 'V');
    assert.equal(formResult(1, 1), 'N');
    assert.equal(formResult(0, 3), 'D');
  });
});

const psgHome = {
  matchday: 1,
  kickoff_at: '2026-08-16',
  home_team_name: 'Paris SG',
  away_team_name: 'Angers',
  home_score: 2,
  away_score: 0,
  home_bsd_team_id: 85,
  away_bsd_team_id: 10,
};

describe('matchSide', () => {
  it('matche par id BSD même si le nom diffère', () => {
    const team = teamMatchKey(85, 'Paris Saint-Germain');
    assert.equal(matchSide(psgHome, team), 'home');
  });

  it('matche par nom normalisé sans id', () => {
    const team = teamMatchKey(null, 'Paris SG');
    const match = { ...psgHome, home_bsd_team_id: null, away_bsd_team_id: null };
    assert.equal(matchSide(match, team), 'home');
  });
});

describe('lastFiveForm', () => {
  const matches = [
    { ...psgHome, matchday: 6, kickoff_at: '2026-09-20', away_team_name: 'Marseille', home_score: 3, away_score: 1, away_bsd_team_id: 2 },
    { matchday: 5, kickoff_at: '2026-09-13', home_team_name: 'Nantes', away_team_name: 'Paris SG', home_score: 0, away_score: 2, home_bsd_team_id: 3, away_bsd_team_id: 85 },
    { ...psgHome, matchday: 4, kickoff_at: '2026-08-30', away_team_name: 'Lyon', home_score: 1, away_score: 1, away_bsd_team_id: 4 },
    { matchday: 3, kickoff_at: '2026-08-23', home_team_name: 'Metz', away_team_name: 'Paris SG', home_score: 1, away_score: 3, home_bsd_team_id: 5, away_bsd_team_id: 85 },
    { ...psgHome, matchday: 2, kickoff_at: '2026-08-17', away_team_name: 'Lille', home_score: 2, away_score: 0, away_bsd_team_id: 6 },
    { ...psgHome, matchday: 1, kickoff_at: '2026-08-16', away_team_name: 'Angers', home_score: 2, away_score: 0, away_bsd_team_id: 10 },
  ];

  it('garde les 5 plus récents, du plus récent au plus ancien', () => {
    const form = lastFiveForm(matches, teamMatchKey(85, 'Paris SG'));
    assert.equal(form.length, 5);
    assert.deepEqual(form.map((m) => m.matchday), [6, 5, 4, 3, 2]);
    assert.deepEqual(form.map((m) => m.result), ['V', 'V', 'N', 'V', 'V']);
    assert.equal(form[1].venue, 'E');
    assert.equal(form[1].opponent, 'Nantes');
    assert.equal(form[1].gf, 2);
    assert.equal(form[1].ga, 0);
    assert.equal(form[0].opp, 'MAR');
    assert.equal(form[0].opponent, 'Marseille');
    assert.equal(form[0].opponent_id, 2);
  });
});

describe('attachFormToStandings', () => {
  it('attache la forme à chaque club', () => {
    const rows = attachFormToStandings(
      [{ position: 1, team_id: 85, team_name: 'Paris SG', points: 13 }],
      [psgHome],
    );
    assert.equal(rows[0].form.length, 1);
    assert.equal(rows[0].form[0].result, 'V');
    assert.equal(rows[0].form[0].opp, 'ANG');
  });

  it('utilise le short_name fourni', () => {
    const rows = attachFormToStandings(
      [{ position: 1, team_id: 85, team_name: 'Paris SG' }],
      [psgHome],
      new Map([[10, 'SCO']]),
    );
    assert.equal(rows[0].form[0].opp, 'SCO');
  });
});

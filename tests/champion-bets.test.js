import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, run, get } from '../server/db/connection.js';
import { scoreChampionBetsForCompetition, resolveCompetitionWinner } from '../server/lib/championBets.js';
import { isCompetitionSeasonFinished, isCompetitionSeasonStarted } from '../server/lib/season.js';

const TEST_EVENT_UPCOMING = -777001;
const TEST_EVENT_LIVE = -777002;

describe('champion bets', { concurrency: 1 }, () => {
  let compId;
  let season;
  let userId;
  let groupId;
  let betId;

  before(async () => {
    await migrate();

    const fixture = await get(
      `SELECT u.id AS user_id, gm.group_id, gc.competition_id
       FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       JOIN group_competitions gc ON gc.group_id = gm.group_id
       LIMIT 1`
    );
    assert.ok(fixture, 'utilisateur avec groupe et championnat requis');

    userId = fixture.user_id;
    groupId = fixture.group_id;
    compId = fixture.competition_id;
    season = '2098-2099';

    await run('DELETE FROM special_bets WHERE user_id = ? AND competition_id = ? AND season = ?', [userId, compId, season]);
    await run(
      `INSERT INTO special_bets (user_id, group_id, competition_id, season, bet_type, bet_value, points)
       VALUES (?, ?, ?, ?, 'champion', 'Inter', 5)`,
      [userId, groupId, compId, season]
    );
    betId = (await get(
      'SELECT id FROM special_bets WHERE user_id = ? AND competition_id = ? AND season = ?',
      [userId, compId, season]
    ))?.id;
  });

  after(async () => {
    await run('DELETE FROM matches WHERE bsd_event_id IN (?, ?)', [TEST_EVENT_UPCOMING, TEST_EVENT_LIVE]);
    if (compId && season && userId) {
      await run('DELETE FROM special_bets WHERE user_id = ? AND competition_id = ? AND season = ?', [userId, compId, season]);
    }
  });

  it('does not award champion points before season kickoff', async () => {
    await run('DELETE FROM matches WHERE bsd_event_id IN (?, ?)', [TEST_EVENT_UPCOMING, TEST_EVENT_LIVE]);
    await run(
      `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name, status, matchday, kickoff_at, season)
       VALUES (?, ?, 'A', 'B', 'scheduled', 1, datetime('now', '+7 days'), ?)`,
      [TEST_EVENT_UPCOMING, compId, season]
    );

    assert.equal(await isCompetitionSeasonStarted(compId, season), false);
    assert.equal(await isCompetitionSeasonFinished(compId, season), false);

    await scoreChampionBetsForCompetition(compId, season);
    const bet = await get('SELECT points FROM special_bets WHERE id = ?', [betId]);
    assert.equal(bet.points, 0);
  });

  it('does not award champion points while season is in progress', async () => {
    await run('DELETE FROM matches WHERE bsd_event_id IN (?, ?)', [TEST_EVENT_UPCOMING, TEST_EVENT_LIVE]);
    await run(
      `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name, status, matchday, kickoff_at, season)
       VALUES (?, ?, 'A', 'B', 'finished', 1, datetime('now', '-2 days'), ?)`,
      [TEST_EVENT_LIVE, compId, season]
    );
    await run(
      `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name, status, matchday, kickoff_at, season)
       VALUES (?, ?, 'C', 'D', 'scheduled', 2, datetime('now', '+7 days'), ?)`,
      [TEST_EVENT_UPCOMING, compId, season]
    );

    assert.equal(await isCompetitionSeasonStarted(compId, season), true);
    assert.equal(await isCompetitionSeasonFinished(compId, season), false);

    await scoreChampionBetsForCompetition(compId, season);
    const bet = await get('SELECT points FROM special_bets WHERE id = ?', [betId]);
    assert.equal(bet.points, 0);
  });
});

describe('champion bets LDC', { concurrency: 1 }, () => {
  const FINAL_EVENT = -888001;
  const SEASON = '2099-2100';
  let ldcId;
  let userId;
  let groupId;

  before(async () => {
    await migrate();
    const { seedCompetitions } = await import('../server/db/seed.js');
    await seedCompetitions();

    const ldc = await get("SELECT id FROM competitions WHERE code = 'LDC'");
    assert.ok(ldc, 'compétition LDC requise');
    ldcId = ldc.id;

    const fixture = await get(
      `SELECT u.id AS user_id, gm.group_id
       FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       LIMIT 1`
    );
    assert.ok(fixture, 'utilisateur avec groupe requis');
    userId = fixture.user_id;
    groupId = fixture.group_id;

    await run('INSERT OR IGNORE INTO group_competitions (group_id, competition_id) VALUES (?, ?)', [groupId, ldcId]);
    await run('DELETE FROM special_bets WHERE competition_id = ? AND season = ?', [ldcId, SEASON]);
    await run('DELETE FROM matches WHERE bsd_event_id = ?', [FINAL_EVENT]);
    await run('DELETE FROM official_standings WHERE competition_id = ? AND season = ?', [ldcId, SEASON]);
  });

  after(async () => {
    await run('DELETE FROM matches WHERE bsd_event_id = ?', [FINAL_EVENT]);
    await run('DELETE FROM special_bets WHERE competition_id = ? AND season = ?', [ldcId, SEASON]);
    await run('DELETE FROM official_standings WHERE competition_id = ? AND season = ?', [ldcId, SEASON]);
  });

  it('prend le vainqueur de la finale plutôt que le 1er de la phase de ligue', async () => {
    await run(
      `INSERT INTO official_standings (competition_id, season, position, team_name, played, won, drawn, lost, goals_for, goals_against, points)
       VALUES (?, ?, 1, 'Bayern Munich', 8, 8, 0, 0, 24, 4, 24)`,
      [ldcId, SEASON]
    );
    await run(
      `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name, home_score, away_score, status, matchday, kickoff_at, season)
       VALUES (?, ?, 'Paris SG', 'Bayern Munich', 2, 0, 'finished', 13, datetime('now', '-2 days'), ?)`,
      [FINAL_EVENT, ldcId, SEASON]
    );

    const winner = await resolveCompetitionWinner(ldcId, SEASON);
    assert.equal(winner, 'Paris SG');

    await run(
      `INSERT INTO special_bets (user_id, group_id, competition_id, season, bet_type, bet_value, points)
       VALUES (?, ?, ?, ?, 'champion', 'Paris SG', 0)`,
      [userId, groupId, ldcId, SEASON]
    );
    await scoreChampionBetsForCompetition(ldcId, SEASON);
    const psg = await get(
      `SELECT points FROM special_bets WHERE user_id = ? AND competition_id = ? AND season = ? AND bet_value = 'Paris SG'`,
      [userId, ldcId, SEASON]
    );
    assert.equal(psg.points, 5);
  });
});

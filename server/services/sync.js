import { all, get, run } from '../db/connection.js';
import * as bsd from './bsd.js';
import { computeMatchdayXi, computeSeasonXiBonus } from '../lib/scoring.js';

/** Mappe les IDs BSD réels depuis l'API (remplace les anciens IDs API-Football). */
export async function syncLeagueIds() {
  try {
    const data = await bsd.getLeagues({ is_active: true, limit: 200 });
    const leagues = bsd.extractResults(data);
    const mapping = {
      L1: { names: ['ligue 1'], country: 'france' },
      PL: { names: ['premier league'], country: 'england' },
      PD: { names: ['la liga'], country: 'spain' },
      SA: { names: ['serie a'], country: 'italy' },
      BL1: { names: ['bundesliga'], country: 'germany' },
    };

    for (const [code, rule] of Object.entries(mapping)) {
      const found = leagues.find(l => {
        const name = (l.name ?? '').toLowerCase();
        const country = (l.country ?? '').toLowerCase();
        return rule.names.some(n => name.includes(n)) && country.includes(rule.country);
      });
      if (found) {
        await run('UPDATE competitions SET bsd_league_id = ? WHERE code = ?', [found.id, code]);
      }
    }
    await logSync('league_ids', 'ok', `${leagues.length} ligues BSD consultées`);
  } catch (err) {
    await logSync('league_ids', 'error', err.message);
    throw err;
  }
}

export async function syncFixtures(competitionId, bsdLeagueId) {
  try {
    let events = [];
    let seasonLabel = '2025-2026';
    try {
      const league = await bsd.getLeague(bsdLeagueId);
      const seasonId = league.current_season?.id;
      seasonLabel = bsd.seasonLabelFromBsd(league.current_season);
      if (seasonId) {
        const raw = await bsd.getAllSeasonEvents(bsdLeagueId, seasonId);
        const allowedTeams = await bsd.getStandingTeamNames(bsdLeagueId);
        events = bsd.filterValidLeagueEvents(raw, allowedTeams);
        const dropped = raw.length - events.length;
        if (dropped > 0) {
          await logSync('fixtures', 'ok', `${dropped} matchs parasites ignorés (ligue ${bsdLeagueId})`);
        }
      }
    } catch {
      // Fallback : matchs des 30 prochains jours
      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const data = await bsd.getEvents({ league_id: bsdLeagueId, date_from: from, date_to: to, limit: 200 });
      events = bsd.extractResults(data);
    }

    const keptIds = new Set();
    let count = 0;
    for (const event of events) {
      const norm = bsd.normalizeEvent(event, competitionId);
      if (!norm.kickoff_at) continue;
      keptIds.add(norm.bsd_event_id);

      await run(
        `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name,
          home_bsd_team_id, away_bsd_team_id, home_score, away_score, status, matchday, kickoff_at, season, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(bsd_event_id) DO UPDATE SET
           home_team_name = excluded.home_team_name, away_team_name = excluded.away_team_name,
           home_bsd_team_id = excluded.home_bsd_team_id, away_bsd_team_id = excluded.away_bsd_team_id,
           home_score = excluded.home_score, away_score = excluded.away_score,
           status = excluded.status, matchday = excluded.matchday,
           kickoff_at = excluded.kickoff_at, season = excluded.season, updated_at = datetime('now')`,
        [norm.bsd_event_id, norm.competition_id, norm.home_team_name, norm.away_team_name,
         norm.home_bsd_team_id, norm.away_bsd_team_id,
         norm.home_score, norm.away_score, norm.status, norm.matchday, norm.kickoff_at, seasonLabel]
      );
      count++;
    }

    // Supprime les matchs BSD devenus invalides (ex. barrages L2 mal importés avant)
    if (keptIds.size > 0) {
      const placeholders = [...keptIds].map(() => '?').join(',');
      await run(
        `DELETE FROM matches WHERE competition_id = ? AND bsd_event_id IS NOT NULL
         AND bsd_event_id NOT IN (${placeholders})`,
        [competitionId, ...keptIds]
      );
    }

    await run('UPDATE competitions SET saison_active = ? WHERE id = ?', [seasonLabel, competitionId]);

    await logSync('fixtures', 'ok', `${count} matchs ligue ${bsdLeagueId} (${seasonLabel})`);
    return count;
  } catch (err) {
    await logSync('fixtures', 'error', err.message);
    throw err;
  }
}

export async function syncLiveScores() {
  if (!process.env.BSD_API_TOKEN?.trim()) return 0;
  try {
    const data = await bsd.getLiveEvents();
    const events = bsd.extractResults(data);
    let count = 0;

    for (const event of events) {
      await run(
        `UPDATE matches SET home_score = ?, away_score = ?, status = ?, updated_at = datetime('now')
         WHERE bsd_event_id = ?`,
        [event.home_score, event.away_score, bsd.normalizeEvent(event, 0).status, event.id]
      );
      count++;
    }

    await logSync('live_scores', 'ok', `${count} scores live`);
    return count;
  } catch (err) {
    await logSync('live_scores', 'error', err.message);
    return 0;
  }
}

export async function syncStandings(competitionId, bsdLeagueId) {
  try {
    const data = await bsd.getStandings(bsdLeagueId);
    const rows = data.standings ?? bsd.extractResults(data);
    let count = 0;

    for (const row of rows) {
      const teamName = row.team?.name ?? row.team_name ?? row.name;
      if (!teamName) continue;
      await run(
        `INSERT INTO official_standings (competition_id, season, position, team_name, played, won, drawn, lost, goals_for, goals_against, points, updated_at)
         VALUES (?, '2025-2026', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(competition_id, season, team_name) DO UPDATE SET
           position = excluded.position, played = excluded.played, won = excluded.won,
           drawn = excluded.drawn, lost = excluded.lost, goals_for = excluded.goals_for,
           goals_against = excluded.goals_against, points = excluded.points, updated_at = datetime('now')`,
        [competitionId, row.position ?? row.rank, teamName,
         row.played ?? row.all?.played ?? 0, row.won ?? row.all?.win ?? 0,
         row.drawn ?? row.all?.draw ?? 0, row.lost ?? row.all?.lose ?? 0,
         row.goals_for ?? row.all?.goals?.for ?? 0, row.goals_against ?? row.all?.goals?.against ?? 0,
         row.points ?? row.all?.points ?? 0]
      );
      count++;
    }

    await logSync('standings', 'ok', `${count} lignes ligue ${bsdLeagueId}`);
    return count;
  } catch (err) {
    await logSync('standings', 'error', err.message);
    throw err;
  }
}

export async function computeMatchdayXiForCompetition(competitionId, season, matchday) {
  const matches = await all(
    `SELECT * FROM matches WHERE competition_id = ? AND season = ? AND matchday = ? AND status IN ('finished', 'FT', 'ended')`,
    [competitionId, season, matchday]
  );

  if (matches.length === 0) return { computed: 0 };

  const allStats = [];
  for (const match of matches) {
    if (!match.bsd_event_id) continue;
    try {
      const data = await bsd.getEventPlayerStats(match.bsd_event_id);
      const players = data.player_stats ?? bsd.extractResults(data);
      allStats.push(...players.map(bsd.normalizePlayerStat));
    } catch { /* BSD pas encore prêt */ }
  }

  const xi = computeMatchdayXi(allStats);
  const now = new Date().toISOString();

  for (const player of xi) {
    await run(
      `INSERT INTO matchday_xi (competition_id, season, matchday, player_id, player_name, position, rating, goals, assists, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(competition_id, season, matchday, player_id) DO UPDATE SET
         rating = excluded.rating, goals = excluded.goals, assists = excluded.assists, computed_at = excluded.computed_at`,
      [competitionId, season, matchday, player.player_id, player.player_name,
       player.position ?? 'MID', player.rating ?? 0, player.goals ?? 0, player.assists ?? 0, now]
    );
  }

  await awardSeasonXiBonus(competitionId, season, matchday);
  await logSync('matchday_xi', 'ok', `J${matchday} comp ${competitionId}: ${xi.length} joueurs`);
  return { computed: xi.length, players: xi };
}

async function awardSeasonXiBonus(competitionId, season, matchday) {
  const xiRows = await all(
    'SELECT player_id FROM matchday_xi WHERE competition_id = ? AND season = ? AND matchday = ?',
    [competitionId, season, matchday]
  );
  const xiIds = xiRows.map(r => r.player_id);

  const groups = await all(
    `SELECT DISTINCT g.id FROM groups g
     JOIN group_competitions gc ON gc.group_id = g.id
     WHERE gc.competition_id = ?`,
    [competitionId]
  );

  const now = new Date().toISOString();

  for (const group of groups) {
    const seasonXis = await all(
      'SELECT id, user_id FROM season_xi WHERE group_id = ? AND season = ?',
      [group.id, season]
    );

    for (const sx of seasonXis) {
      const members = await all(
        'SELECT player_id FROM season_xi_players WHERE season_xi_id = ?',
        [sx.id]
      );
      const memberIds = members.map(m => m.player_id);
      const bonus = computeSeasonXiBonus(memberIds, xiIds);

      await run(
        `INSERT INTO season_xi_points (user_id, group_id, competition_id, season, matchday, points, detail, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, group_id, competition_id, season, matchday) DO UPDATE SET
           points = excluded.points, detail = excluded.detail, computed_at = excluded.computed_at`,
        [sx.user_id, group.id, competitionId, season, matchday, bonus.points,
         JSON.stringify(bonus.matchingPlayerIds), now]
      );
    }
  }
}

async function logSync(type, status, details) {
  await run('INSERT INTO sync_log (sync_type, status, details) VALUES (?, ?, ?)', [type, status, details]);
}

export async function syncAllCompetitions() {
  const comps = await all('SELECT id, bsd_league_id FROM competitions WHERE bsd_league_id IS NOT NULL');
  for (const c of comps) {
    await syncFixtures(c.id, c.bsd_league_id);
  }
}

export async function syncAllStandings() {
  const comps = await all('SELECT id, bsd_league_id FROM competitions WHERE bsd_league_id IS NOT NULL');
  for (const c of comps) {
    await syncStandings(c.id, c.bsd_league_id);
  }
}

/** Supprime les faux matchs laissés par les tests (A vs B, etc.) */
export async function cleanupTestMatches() {
  await run(`DELETE FROM matches WHERE bsd_event_id IS NULL`);
}

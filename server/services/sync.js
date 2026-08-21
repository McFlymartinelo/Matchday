import { all, get, run } from '../db/connection.js';
import * as bsd from './bsd.js';
import { computeMatchdayXi, computeSeasonXiBonus, scorePrediction } from '../lib/scoring.js';
import { dedupeBsdEvents, dedupeCompetitionMatches } from '../lib/matches.js';
import { applyVenueOverride, invertPersistedVenueOverrides } from '../lib/matchOverrides.js';

function normalizeWithOverrides(event, competitionId) {
  return applyVenueOverride(bsd.normalizeEvent(event, competitionId));
}

/** Mappe les IDs BSD réels depuis l'API (remplace les anciens IDs API-Football). */
export async function syncLeagueIds() {
  try {
    // BSD refuse les params inconnus (400). Pas de `is_active` — les ligues inactives sont masquées par défaut.
    const data = await bsd.getLeagues({ limit: 200 });
    const leagues = bsd.extractResults(data);
    const mapping = {
      L1: { names: ['ligue 1'], country: 'france' },
      PL: { names: ['premier league'], country: 'england' },
      PD: { names: ['laliga', 'la liga', 'primera'], country: 'spain' },
      SA: { names: ['serie a'], country: 'italy' },
      BL1: { names: ['bundesliga'], country: 'germany' },
    };

    for (const [code, rule] of Object.entries(mapping)) {
      const found = leagues.find(l => {
        if (l.is_women) return false;
        const name = (l.name ?? '').toLowerCase();
        const compact = name.replace(/[\s-]/g, '');
        const country = (l.country ?? '').toLowerCase();
        const nameMatch = rule.names.some(n => name.includes(n) || compact.includes(n.replace(/[\s-]/g, '')));
        return nameMatch && country.includes(rule.country);
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
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);

    try {
      const league = await bsd.getLeague(bsdLeagueId);

      // Chemin rapide : calendrier à venir (saison 26/27 même si BSD current_season = 25/26)
      events = await bsd.collectUpcomingFixtures(bsdLeagueId);

      // Enrichissement optionnel : saison courante complète (historique / live)
      try {
        const full = await bsd.collectLeagueFixtures(bsdLeagueId, league);
        const byId = new Map(events.map(e => [e.id, e]));
        for (const e of full) byId.set(e.id, e);
        events = [...byId.values()];
      } catch (innerErr) {
        await logSync('fixtures', 'ok', `collect complet ignoré ligue ${bsdLeagueId}: ${innerErr.message}`);
      }

      seasonLabel = events.length
        ? bsd.resolveActiveSeasonLabel(league, events)
        : bsd.seasonLabelFromBsd(league.current_season);
    } catch (err) {
      await logSync('fixtures', 'ok', `collect ligue ${bsdLeagueId} en fallback: ${err.message}`);
      events = await bsd.getEventsByDateRange(bsdLeagueId, from, to);
      if (events.length) seasonLabel = bsd.seasonLabelFromKickoff(events[0].event_date);
    }

    let count = 0;
    const normalized = dedupeBsdEvents(events, competitionId, normalizeWithOverrides);
    for (const norm of normalized) {
      const matchSeason = bsd.seasonLabelFromKickoff(norm.kickoff_at);
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
         norm.home_score, norm.away_score, norm.status, norm.matchday, norm.kickoff_at, matchSeason]
      );
      count++;
    }

    if (count > 0) {
      const merged = await dedupeCompetitionMatches(competitionId);
      if (merged > 0) {
        await logSync('fixtures', 'ok', `${merged} doublon(s) fusionné(s) ligue ${bsdLeagueId}`);
      }
      await run(
        `DELETE FROM matches WHERE competition_id = ? AND bsd_event_id IS NOT NULL AND bsd_event_id < 0`,
        [competitionId]
      );
      await run(
        `DELETE FROM matches WHERE competition_id = ? AND season != ?
         AND kickoff_at < datetime('now')
         AND NOT EXISTS (SELECT 1 FROM predictions p WHERE p.match_id = matches.id)`,
        [competitionId, seasonLabel]
      );
    }

    await run('UPDATE competitions SET saison_active = ? WHERE id = ?', [seasonLabel, competitionId]);

    await logSync('fixtures', 'ok', `${count} matchs ligue ${bsdLeagueId} (${seasonLabel})`);
    return count;
  } catch (err) {
    await logSync('fixtures', 'error', `ligue ${bsdLeagueId}: ${err.message}`);
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
      const norm = normalizeWithOverrides(event, 0);
      await run(
        `UPDATE matches SET home_score = ?, away_score = ?, status = ?, updated_at = datetime('now')
         WHERE bsd_event_id = ?`,
        [norm.home_score, norm.away_score, norm.status, event.id]
      );
      count++;
    }

    await logSync('live_scores', 'ok', `${count} scores live`);
    await autoRecalculateFinishedMatches();
    return count;
  } catch (err) {
    await logSync('live_scores', 'error', err.message);
    return 0;
  }
}

export async function autoRecalculateFinishedMatches() {
  const groupRows = await all(
    'SELECT id, scoring_exact, scoring_diff, scoring_winner FROM groups'
  );

  let total = 0;
  for (const group of groupRows) {
    const compRows = await all(
      'SELECT competition_id FROM group_competitions WHERE group_id = ?',
      [group.id]
    );
    if (!compRows.length) continue;

    const placeholders = compRows.map(() => '?').join(',');
    const preds = await all(
      `SELECT p.*, m.home_score AS actual_home, m.away_score AS actual_away
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       WHERE p.group_id = ?
         AND m.competition_id IN (${placeholders})
         AND m.status IN ('finished', 'FT', 'ended')
         AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
         AND p.points IS NULL`,
      [group.id, ...compRows.map(r => r.competition_id)]
    );

    const scoring = { exact: group.scoring_exact, diff: group.scoring_diff, winner: group.scoring_winner };
    for (const p of preds) {
      const result = scorePrediction(
        Number(p.home_score), Number(p.away_score),
        Number(p.actual_home), Number(p.actual_away),
        scoring
      );
      await run(
        'UPDATE predictions SET points = ?, points_detail = ? WHERE id = ?',
        [result.points, result.detail, p.id]
      );
      total++;
    }
  }

  if (total > 0) await logSync('auto_recalculate', 'ok', `${total} pronostic(s) recalculé(s)`);
  return total;
}

async function resolveBsdSeasonId(bsdLeagueId, seasonLabel) {
  try {
    const seasons = await bsd.getLeagueSeasons(bsdLeagueId);
    const fromList = bsd.findSeasonIdForLabel(seasons, seasonLabel);
    if (fromList) return fromList;
  } catch { /* liste des saisons indisponible */ }

  try {
    const current = await bsd.getCurrentSeason(bsdLeagueId);
    if (current?.id && bsd.seasonLabelFromBsd(current) === seasonLabel) return current.id;
  } catch { /* ignore */ }

  try {
    const league = await bsd.getLeague(bsdLeagueId);
    const cur = league?.current_season;
    if (cur?.id && bsd.seasonLabelFromBsd(cur) === seasonLabel) return cur.id;
  } catch { /* ignore */ }

  return null;
}

async function computeStandingsFromMatches(competitionId, seasonLabel) {
  const matches = await all(
    `SELECT home_team_name, away_team_name, home_score, away_score, home_bsd_team_id, away_bsd_team_id
     FROM matches
     WHERE competition_id = ? AND season = ?
       AND status IN ('finished', 'FT', 'ended')
       AND home_score IS NOT NULL AND away_score IS NOT NULL`,
    [competitionId, seasonLabel]
  );
  if (!matches.length) return [];

  const table = new Map();
  const ensure = (name, id) => {
    const key = bsd.normalizeTeamName(name);
    if (!table.has(key)) {
      table.set(key, {
        team_name: name, team_id: id ?? null,
        played: 0, won: 0, drawn: 0, lost: 0,
        goals_for: 0, goals_against: 0, points: 0,
      });
    }
    const row = table.get(key);
    if (id && !row.team_id) row.team_id = id;
    return row;
  };

  for (const m of matches) {
    const home = ensure(m.home_team_name, m.home_bsd_team_id);
    const away = ensure(m.away_team_name, m.away_bsd_team_id);
    const hs = Number(m.home_score);
    const as = Number(m.away_score);
    home.played += 1;
    away.played += 1;
    home.goals_for += hs;
    home.goals_against += as;
    away.goals_for += as;
    away.goals_against += hs;
    if (hs > as) {
      home.won += 1;
      away.lost += 1;
      home.points += 3;
    } else if (hs < as) {
      away.won += 1;
      home.lost += 1;
      away.points += 3;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  return [...table.values()]
    .sort((a, b) => b.points - a.points
      || (b.goals_for - b.goals_against) - (a.goals_for - a.goals_against)
      || b.goals_for - a.goals_for)
    .map((r, i) => ({ ...r, position: i + 1 }));
}

async function rosterStandingsFromMatches(competitionId, seasonLabel) {
  const teams = await all(
    `SELECT team_name FROM (
       SELECT home_team_name AS team_name FROM matches WHERE competition_id = ? AND season = ?
       UNION
       SELECT away_team_name FROM matches WHERE competition_id = ? AND season = ?
     ) ORDER BY team_name`,
    [competitionId, seasonLabel, competitionId, seasonLabel]
  );
  const idRows = await all(
    `SELECT home_team_name AS team_name, home_bsd_team_id AS team_id FROM matches
     WHERE competition_id = ? AND season = ? AND home_bsd_team_id IS NOT NULL
     UNION ALL
     SELECT away_team_name, away_bsd_team_id FROM matches
     WHERE competition_id = ? AND season = ? AND away_bsd_team_id IS NOT NULL`,
    [competitionId, seasonLabel, competitionId, seasonLabel]
  );
  const idMap = new Map();
  for (const r of idRows) {
    idMap.set(bsd.normalizeTeamName(r.team_name), r.team_id);
  }
  return teams.map((t, i) => ({
    position: i + 1,
    team_name: t.team_name,
    team_id: idMap.get(bsd.normalizeTeamName(t.team_name)) ?? null,
    played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0,
  }));
}

function standingsLookEmpty(rows) {
  return !rows.length || rows.every(r => (r.played ?? 0) === 0 && (r.points ?? 0) === 0);
}

export async function syncStandings(competitionId, bsdLeagueId) {
  try {
    const comp = await get('SELECT saison_active FROM competitions WHERE id = ?', [competitionId]);
    const seasonLabel = comp?.saison_active ?? '2025-2026';

    const seasonId = await resolveBsdSeasonId(bsdLeagueId, seasonLabel);
    let rows = [];
    if (seasonId) {
      const data = await bsd.getStandings(bsdLeagueId, { season_id: seasonId });
      rows = bsd.extractStandingsRows(data)
        .map(bsd.normalizeStandingRow)
        .filter(Boolean);
    }

    if (standingsLookEmpty(rows)) {
      const computed = await computeStandingsFromMatches(competitionId, seasonLabel);
      if (computed.length) rows = computed;
    }

    if (!rows.length) {
      rows = await rosterStandingsFromMatches(competitionId, seasonLabel);
    }

    if (!rows.length) {
      await logSync('standings', 'ok', `0 lignes ligue ${bsdLeagueId} (${seasonLabel})`);
      return 0;
    }

    await run('DELETE FROM official_standings WHERE competition_id = ? AND season = ?', [competitionId, seasonLabel]);

    let count = 0;
    for (const row of rows) {
      await run(
        `INSERT INTO official_standings (competition_id, season, position, team_id, team_name, played, won, drawn, lost, goals_for, goals_against, points, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(competition_id, season, team_name) DO UPDATE SET
           team_id = excluded.team_id, position = excluded.position, played = excluded.played, won = excluded.won,
           drawn = excluded.drawn, lost = excluded.lost, goals_for = excluded.goals_for,
           goals_against = excluded.goals_against, points = excluded.points, updated_at = datetime('now')`,
        [competitionId, seasonLabel, row.position ?? row.rank, row.team_id ?? null, row.team_name,
         row.played ?? 0, row.won ?? 0, row.drawn ?? 0, row.lost ?? 0,
         row.goals_for ?? 0, row.goals_against ?? 0, row.points ?? 0]
      );
      count++;
    }

    await logSync('standings', 'ok', `${count} lignes ligue ${bsdLeagueId} (${seasonLabel}${seasonId ? `, season ${seasonId}` : ''})`);
    const { scoreChampionBetsForCompetition } = await import('../lib/championBets.js');
    await scoreChampionBetsForCompetition(competitionId, seasonLabel);
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
  const comps = await all('SELECT id, bsd_league_id, code FROM competitions WHERE bsd_league_id IS NOT NULL');
  let total = 0;
  for (const c of comps) {
    try {
      total += await syncFixtures(c.id, c.bsd_league_id);
    } catch (err) {
      console.error(`Sync calendrier ${c.code} échouée:`, err.message);
    }
  }
  await invertPersistedVenueOverrides();
  return total;
}

export async function syncAllStandings() {
  const comps = await all('SELECT id, bsd_league_id, code FROM competitions WHERE bsd_league_id IS NOT NULL');
  for (const c of comps) {
    try {
      await syncStandings(c.id, c.bsd_league_id);
    } catch (err) {
      console.error(`Sync classement ${c.code} échouée:`, err.message);
    }
  }
}

/** Supprime les faux matchs laissés par les tests (A vs B, etc.) */
export async function cleanupTestMatches() {
  await run(`DELETE FROM matches WHERE bsd_event_id IS NULL`);
}

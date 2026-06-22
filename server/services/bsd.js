import 'dotenv/config';

const BASE_URL = process.env.BSD_BASE_URL || 'https://sports.bzzoiro.com';
const TOKEN = process.env.BSD_API_TOKEN?.trim();

async function bsdFetch(path, params = {}) {
  if (!TOKEN) throw new Error('BSD_API_TOKEN manquant dans .env');

  const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, v);
  });

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json', Authorization: `Token ${TOKEN}` },
  });

  if (res.status === 401) {
    throw new Error('Token BSD invalide — vérifie BSD_API_TOKEN sur sports.bzzoiro.com');
  }
  if (!res.ok) throw new Error(`BSD ${res.status}: ${path}`);
  return res.json();
}

export async function getLeagues(params = {}) {
  return bsdFetch('/api/v2/leagues/', params);
}

export async function getLeague(leagueId) {
  return bsdFetch(`/api/v2/leagues/${leagueId}/`);
}

export async function getEvents(params = {}) {
  return bsdFetch('/api/v2/events/', params);
}

export async function getLiveEvents(params = {}) {
  return bsdFetch('/api/v2/events/live/', params);
}

export async function getEventPlayerStats(eventId) {
  return bsdFetch(`/api/v2/events/${eventId}/player-stats/`);
}

export async function getPlayerStats(playerId) {
  return bsdFetch(`/api/v2/players/${playerId}/stats/`);
}

export async function searchPlayers(params = {}) {
  // BSD utilise le paramètre "name", pas "search"
  const { search, name, ...rest } = params;
  return bsdFetch('/api/v2/players/', { name: name ?? search, ...rest });
}

export async function getTeams(params = {}) {
  return bsdFetch('/api/v2/teams/', params);
}

export async function getTeamSquad(teamId) {
  return bsdFetch(`/api/v2/teams/${teamId}/squad/`);
}

export function normalizeXiPosition(pos) {
  const map = {
    G: 'GK', GK: 'GK', Goalkeeper: 'GK',
    D: 'DEF', DEF: 'DEF', Defender: 'DEF',
    M: 'MID', MID: 'MID', Midfielder: 'MID',
    F: 'FWD', FWD: 'FWD', Forward: 'FWD', Attacker: 'FWD',
  };
  return map[pos] ?? pos ?? 'MID';
}

export function normalizePlayerListItem(player, teamInfo) {
  const teamId = player.current_team_id ?? player.team_id ?? teamInfo?.team_id;
  return {
    player_id: player.id ?? player.player_id,
    player_name: player.name ?? player.player_name ?? player.short_name,
    team_id: teamId,
    team_name: teamInfo?.team_name ?? player.team_name ?? player.current_team_name ?? 'Club inconnu',
    competition_id: teamInfo?.competition_id,
    comp_code: teamInfo?.comp_code,
    comp_nom: teamInfo?.comp_nom,
    position: normalizeXiPosition(player.position ?? player.specific_position),
  };
}

export async function getStandings(leagueId, params = {}) {
  return bsdFetch(`/api/v2/leagues/${leagueId}/standings/`, params);
}

/** Matchs sur une plage de dates (pagination). */
export async function getEventsByDateRange(leagueId, dateFrom, dateTo) {
  const events = [];
  const pageSize = 200;
  for (let offset = 0; offset < 2000; offset += pageSize) {
    const data = await getEvents({
      league_id: leagueId,
      date_from: dateFrom,
      date_to: dateTo,
      limit: pageSize,
      offset,
    });
    const batch = extractResults(data);
    events.push(...batch);
    if (batch.length < pageSize) break;
  }
  return events;
}

export function seasonLabelFromKickoff(isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '2025-2026';
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (m >= 6) return `${y}-${y + 1}`;
  return `${y - 1}-${y}`;
}

export async function getUnavailable(eventId) {
  return bsdFetch(`/api/v2/events/${eventId}/unavailable/`);
}

export function extractResults(data) {
  return data.results ?? data.events ?? data.player_stats ?? (Array.isArray(data) ? data : []);
}

/** Récupère tous les matchs d'une saison BSD (pagination). */
export async function getAllSeasonEvents(leagueId, seasonId) {
  const events = [];
  const pageSize = 200;
  for (let offset = 0; offset < 2000; offset += pageSize) {
    const data = await getEvents({ league_id: leagueId, season_id: seasonId, limit: pageSize, offset });
    const batch = extractResults(data);
    events.push(...batch);
    if (batch.length < pageSize) break;
  }
  return events;
}

export function normalizeTeamName(name) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Équipes du classement officiel BSD (source de vérité pour filtrer les matchs parasites). */
export async function getStandingTeams(leagueId, seasonId = null) {
  try {
    const params = seasonId ? { season_id: seasonId } : {};
    const data = await getStandings(leagueId, params);
    const rows = data.standings ?? extractResults(data);
    if (rows.length < 8) return null;
    return rows
      .map(row => ({
        team_id: row.team_id ?? row.team?.id,
        team_name: row.team_name ?? row.team?.name ?? row.name,
      }))
      .filter(t => t.team_id && t.team_name);
  } catch {
    return null;
  }
}

export async function getStandingTeamNames(leagueId, seasonId = null) {
  const teams = await getStandingTeams(leagueId, seasonId);
  if (!teams?.length) return null;
  return new Set(teams.map(t => normalizeTeamName(t.team_name)));
}

export function eventTeamsInStandings(event, allowedTeams) {
  if (!allowedTeams?.size) return true;
  const home = normalizeTeamName(event.home_team ?? event.home_team_name);
  const away = normalizeTeamName(event.away_team ?? event.away_team_name);
  return allowedTeams.has(home) && allowedTeams.has(away);
}

/**
 * Retire les matchs d'une journée dont la date est aberrante
 * (ex. barrages L2 tagués en J1 de L1, 8 mois après les autres matchs).
 */
export function filterEventsByRoundDateConsistency(events) {
  const byRound = new Map();
  for (const e of events) {
    const rd = e.round_number ?? e.matchday ?? 0;
    if (!byRound.has(rd)) byRound.set(rd, []);
    byRound.get(rd).push(e);
  }

  const filtered = [];
  for (const roundEvents of byRound.values()) {
    const dated = roundEvents
      .map(e => ({ e, t: new Date(e.event_date ?? e.date ?? e.kickoff).getTime() }))
      .filter(x => !Number.isNaN(x.t));

    if (dated.length < 3) {
      filtered.push(...roundEvents);
      continue;
    }

    dated.sort((a, b) => a.t - b.t);
    const median = dated[Math.floor(dated.length / 2)].t;
    const maxDiff = 12 * 86400000;

    for (const { e, t } of dated) {
      if (Math.abs(t - median) <= maxDiff) filtered.push(e);
    }
  }
  return filtered;
}

export function filterValidLeagueEvents(events, allowedTeams) {
  let list = allowedTeams?.size
    ? events.filter(e => eventTeamsInStandings(e, allowedTeams))
    : events;
  list = filterEventsByRoundDateConsistency(list);
  return list;
}

/** Matchs à venir sur ~13 mois (récupère la saison suivante quand current_season BSD est en retard). */
export async function collectUpcomingFixtures(leagueId) {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
  const raw = await getEventsByDateRange(leagueId, from, to);
  // Calendrier officiel BSD — ne pas filtrer via le classement de la saison précédente
  // (sinon les promus/disparus manquent, ex. Le Mans, Troyes en L1 26/27).
  return filterEventsByRoundDateConsistency(raw);
}

/** Calendrier complet : matchs à venir + saison courante BSD. */
export async function collectLeagueFixtures(leagueId, league) {
  const rawById = new Map();
  const upcoming = await collectUpcomingFixtures(leagueId);
  for (const e of upcoming) rawById.set(e.id, e);

  const currentSeasonId = league?.current_season?.id;
  if (currentSeasonId) {
    const current = await getAllSeasonEvents(leagueId, currentSeasonId);
    for (const e of current) rawById.set(e.id, e);
  }

  return [...rawById.values()];
}

export function resolveActiveSeasonLabel(league, events) {
  const now = Date.now();
  const future = events
    .filter(e => {
      const t = new Date(e.event_date ?? e.date ?? e.kickoff).getTime();
      return !Number.isNaN(t) && t >= now && (e.status === 'notstarted' || e.status === 'scheduled');
    })
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

  if (future.length) return seasonLabelFromKickoff(future[0].event_date);
  return seasonLabelFromBsd(league?.current_season);
}

export function seasonLabelFromBsd(season) {
  if (!season) return '2025-2026';
  if (season.name?.includes('25/26') || season.year === 2025) return '2025-2026';
  if (season.name?.includes('26/27') || season.year === 2026) return '2026-2027';
  const y = season.year ?? new Date().getFullYear();
  return `${y}-${y + 1}`;
}

export function normalizeEvent(event, competitionId) {
  return {
    bsd_event_id: event.id,
    competition_id: competitionId,
    home_team_name: event.home_team ?? 'Domicile',
    away_team_name: event.away_team ?? 'Extérieur',
    home_bsd_team_id: event.home_team_id ?? null,
    away_bsd_team_id: event.away_team_id ?? null,
    home_score: event.home_score ?? null,
    away_score: event.away_score ?? null,
    status: mapStatus(event.status),
    matchday: event.round_number ?? event.matchday ?? null,
    kickoff_at: event.event_date ?? event.date ?? event.kickoff,
  };
}

function mapStatus(status) {
  const map = {
    notstarted: 'scheduled',
    inprogress: 'live',
    finished: 'finished',
    penalties: 'live',
  };
  return map[status] ?? status ?? 'scheduled';
}

export function normalizePlayerStat(stat) {
  return {
    player_id: stat.player_id ?? stat.id,
    player_name: stat.player_name ?? stat.name ?? `Joueur ${stat.player_id}`,
    position: stat.position ?? stat.player?.position ?? 'MID',
    rating: stat.rating ?? null,
    goals: stat.goals ?? 0,
    assists: stat.goal_assist ?? stat.assists ?? 0,
    minutes: stat.minutes_played ?? stat.minutes ?? 0,
    team_id: stat.team_id,
    team_name: stat.team_name,
  };
}

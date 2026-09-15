/** Codes des coupes européennes (phase de ligue + élimination). */
export const CUP_CODES = new Set(['LDC']);

export const CHAMPION_BETS_DEADLINE = new Date('2026-09-04T00:00:00');
export const LDC_CHAMPION_BETS_DEADLINE = new Date('2026-09-20T23:59:00');

export const LDC_LEAGUE_PHASE_MAX_MD = 8;

export function isCupCompetition(code) {
  return CUP_CODES.has(String(code ?? '').toUpperCase());
}

export function championBetDeadline(code) {
  return isCupCompetition(code) ? LDC_CHAMPION_BETS_DEADLINE : CHAMPION_BETS_DEADLINE;
}

export function isChampionBetOpen(code, { now = new Date() } = {}) {
  return now < championBetDeadline(code);
}

/** Matchs de la phase de ligue LDC (J1–J8, à partir de septembre). */
export function isLeaguePhaseMatch(code, matchday, kickoffAt, seasonLabel) {
  if (!isCupCompetition(code)) return true;
  const md = Number(matchday);
  if (!Number.isFinite(md) || md < 1 || md > LDC_LEAGUE_PHASE_MAX_MD) return false;
  const startYear = String(seasonLabel ?? '').slice(0, 4);
  if (/^\d{4}$/.test(startYear) && kickoffAt) {
    const t = new Date(kickoffAt).getTime();
    const from = Date.parse(`${startYear}-09-01T00:00:00Z`);
    if (!Number.isNaN(t) && !Number.isNaN(from) && t < from) return false;
  }
  return true;
}

/** Phase de ligue + élimination directe — hors tours préliminaires d’été. */
export function isChampionsLeagueMainEvent(code, roundName, kickoffAt, seasonLabel) {
  if (!isCupCompetition(code)) return true;
  const name = String(roundName ?? '').toLowerCase();
  if (name.includes('qualif')) return false;
  const startYear = String(seasonLabel ?? '').slice(0, 4);
  if (/^\d{4}$/.test(startYear) && kickoffAt) {
    const t = new Date(kickoffAt).getTime();
    const from = Date.parse(`${startYear}-09-01T00:00:00Z`);
    if (!Number.isNaN(t) && !Number.isNaN(from) && t < from) return false;
  }
  return true;
}

const COUNTRY_ALIASES = {
  germany: ['germany', 'deutschland', 'de', 'ger'],
  france: ['france', 'fr', 'fra'],
  england: ['england', 'uk', 'gb', 'gbr', 'united kingdom'],
  spain: ['spain', 'españa', 'espana', 'es', 'esp'],
  italy: ['italy', 'italia', 'it', 'ita'],
};

function countryMatches(leagueCountry, ruleCountry) {
  const hay = String(leagueCountry ?? '').toLowerCase();
  const needle = String(ruleCountry ?? '').toLowerCase();
  if (!needle) return true;
  if (hay.includes(needle) || needle.includes(hay)) return true;
  const aliases = COUNTRY_ALIASES[needle] ?? [needle];
  return aliases.some(a => hay.includes(a));
}

/** D2 / D3 / coupes nationales — jamais la D1. */
export function isSecondaryDomesticLeague(name) {
  const n = String(name ?? '').toLowerCase().trim();
  if (!n) return false;
  if (/^[23](\.|nd|rd)?\b/.test(n)) return true;
  if (/\b(2\.?\s*bundesliga|bundesliga\s*2|zweite)\b/.test(n)) return true;
  if (/\b(3\.?\s*liga|liga\s*3)\b/.test(n)) return true;
  if (/\b(championship|league\s*one|league\s*two)\b/.test(n)) return true;
  if (/\b(ligue\s*2|serie\s*[bc]|segunda|hypermotion|laliga\s*2)\b/.test(n)) return true;
  return false;
}

export function matchesBsdLeagueRule(league, rule) {
  if (!league || league.is_women) return false;
  const name = String(league.name ?? '').toLowerCase();
  const compact = name.replace(/[\s.-]/g, '');
  const country = String(league.country ?? '').toLowerCase();
  if (isSecondaryDomesticLeague(name)) return false;
  if (rule.exclude?.some(x => {
    const needle = x.toLowerCase();
    return name.includes(needle) || compact.includes(needle.replace(/[\s.-]/g, ''));
  })) return false;
  const nameMatch = rule.names.some(n => {
    const needle = n.toLowerCase();
    return name.includes(needle) || compact.includes(needle.replace(/[\s.-]/g, ''));
  });
  if (!nameMatch) return false;
  if (!rule.country) return true;
  const countries = Array.isArray(rule.country) ? rule.country : [rule.country];
  return countries.some(c => countryMatches(country, c));
}

function bsdLeagueScore(league, rule) {
  const name = String(league.name ?? '').toLowerCase().trim();
  let score = 0;
  if (name.includes('uefa')) score += 1000;
  if ((rule.names ?? []).some(n => name === n.toLowerCase())) score += 500;
  if (/^1(\.|st)?\b/.test(name)) score += 200;
  if (isSecondaryDomesticLeague(name)) score -= 2000;
  return score - name.length;
}

export function pickBsdLeague(leagues, rule) {
  const candidates = leagues.filter(l => matchesBsdLeagueRule(l, rule));
  if (!candidates.length) return null;
  return candidates.slice().sort((a, b) => bsdLeagueScore(b, rule) - bsdLeagueScore(a, rule))[0];
}

export const BSD_LEAGUE_MAPPING = {
  L1: { names: ['ligue 1'], country: 'france' },
  PL: { names: ['premier league'], country: 'england' },
  PD: {
    names: ['laliga', 'la liga', 'primera'],
    country: 'spain',
    exclude: ['hypermotion', 'segunda', 'laliga2', 'la liga 2'],
  },
  SA: { names: ['serie a'], country: 'italy', exclude: ['serie b', 'serie c'] },
  BL1: {
    names: ['bundesliga'],
    country: 'germany',
    exclude: [
      '2. bundesliga', '2 bundesliga', 'bundesliga 2', 'zweite',
      '3. liga', '3 liga', 'frauen', 'playoff', 'play-off',
      'relegation', 'junior', 'u19', 'u17',
    ],
  },
  LDC: {
    names: ['uefa champions league', 'champions league'],
    country: ['europe', 'uefa', 'world', 'international', ''],
    exclude: ['women', 'youth', 'u19', 'u21', 'qualif', 'afc', 'caf', 'concacaf', 'ofc'],
  },
};

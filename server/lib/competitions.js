/** Codes des coupes européennes (phase de ligue + élimination). */
export const CUP_CODES = new Set(['LDC']);

export const CHAMPION_BETS_DEADLINE = new Date('2026-09-04T00:00:00');
export const LDC_CHAMPION_BETS_DEADLINE = new Date('2026-09-08T18:00:00');

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

export function matchesBsdLeagueRule(league, rule) {
  if (!league || league.is_women) return false;
  const name = String(league.name ?? '').toLowerCase();
  const compact = name.replace(/[\s-]/g, '');
  const country = String(league.country ?? '').toLowerCase();
  if (rule.exclude?.some(x => name.includes(x))) return false;
  const nameMatch = rule.names.some(n => {
    const needle = n.toLowerCase();
    return name.includes(needle) || compact.includes(needle.replace(/[\s-]/g, ''));
  });
  if (!nameMatch) return false;
  if (!rule.country) return true;
  const countries = Array.isArray(rule.country) ? rule.country : [rule.country];
  return countries.some(c => !c || country.includes(c));
}

export function pickBsdLeague(leagues, rule) {
  const candidates = leagues.filter(l => matchesBsdLeagueRule(l, rule));
  if (!candidates.length) return null;
  return candidates.find(l => String(l.name ?? '').toLowerCase().includes('uefa')) ?? candidates[0];
}

export const BSD_LEAGUE_MAPPING = {
  L1: { names: ['ligue 1'], country: 'france' },
  PL: { names: ['premier league'], country: 'england' },
  PD: { names: ['laliga', 'la liga', 'primera'], country: 'spain' },
  SA: { names: ['serie a'], country: 'italy' },
  BL1: { names: ['bundesliga'], country: 'germany' },
  LDC: {
    names: ['uefa champions league', 'champions league'],
    country: ['europe', 'uefa', 'world', 'international', ''],
    exclude: ['women', 'youth', 'u19', 'u21', 'qualif', 'afc', 'caf', 'concacaf', 'ofc'],
  },
};

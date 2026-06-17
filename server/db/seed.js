import { run, get } from './connection.js';

const COMPETITIONS = [
  { code: 'L1', bsd_league_id: null, nom: 'Ligue 1', pays: 'France', emoji: '🇫🇷', couleur: '#2D8B57', couleur_bg: '#E2F5EA' },
  { code: 'PL', bsd_league_id: null, nom: 'Premier League', pays: 'Angleterre', emoji: '🏴', couleur: '#6B3FD6', couleur_bg: '#EFE8FC' },
  { code: 'PD', bsd_league_id: null, nom: 'Liga', pays: 'Espagne', emoji: '🇪🇸', couleur: '#E0532E', couleur_bg: '#FCE7E1' },
  { code: 'SA', bsd_league_id: null, nom: 'Serie A', pays: 'Italie', emoji: '🇮🇹', couleur: '#1C6FD0', couleur_bg: '#E3EFFC' },
  { code: 'BL1', bsd_league_id: null, nom: 'Bundesliga', pays: 'Allemagne', emoji: '🇩🇪', couleur: '#C9701F', couleur_bg: '#FDF1E2' },
];

/** Matchs de démo si BSD indisponible — pronostics ouverts */
const DEMO_MATCHES = [
  { id: -9001, comp: 'L1', home: 'Paris SG', away: 'Marseille', matchday: 24, daysAhead: 2 },
  { id: -9002, comp: 'L1', home: 'Lyon', away: 'Monaco', matchday: 24, daysAhead: 2 },
  { id: -9003, comp: 'L1', home: 'Lille', away: 'Nice', matchday: 24, daysAhead: 3 },
  { id: -9004, comp: 'PD', home: 'Real Madrid', away: 'Barcelone', matchday: 28, daysAhead: 4 },
  { id: -9005, comp: 'PD', home: 'Atlético Madrid', away: 'Séville', matchday: 28, daysAhead: 4 },
  { id: -9006, comp: 'PL', home: 'Arsenal', away: 'Liverpool', matchday: 30, daysAhead: 5 },
  { id: -9007, comp: 'PL', home: 'Manchester City', away: 'Chelsea', matchday: 30, daysAhead: 5 },
];

export async function seedCompetitions() {
  for (const c of COMPETITIONS) {
    const existing = await get('SELECT id FROM competitions WHERE code = ?', [c.code]);
    if (!existing) {
      await run(
        `INSERT INTO competitions (code, bsd_league_id, nom, pays, emoji, couleur, couleur_bg, saison_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, '2025-2026')`,
        [c.code, c.bsd_league_id, c.nom, c.pays, c.emoji, c.couleur, c.couleur_bg]
      );
    }
  }
}

export async function seedDemoMatches() {
  const count = await get('SELECT COUNT(*) as n FROM matches');
  if (count?.n > 0) return;

  for (const m of DEMO_MATCHES) {
    const comp = await get('SELECT id FROM competitions WHERE code = ?', [m.comp]);
    if (!comp) continue;
    const kickoff = new Date(Date.now() + m.daysAhead * 86400000 + 18 * 3600000).toISOString();
    await run(
      `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name, status, matchday, kickoff_at, season)
       VALUES (?, ?, ?, ?, 'scheduled', ?, ?, '2025-2026')`,
      [m.id, comp.id, m.home, m.away, m.matchday, kickoff]
    );
  }
}

if (process.argv[1]?.includes('seed.js')) {
  const { migrate } = await import('./connection.js');
  await migrate();
  await seedCompetitions();
  await seedDemoMatches();
  console.log('Seed terminé.');
}

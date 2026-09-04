import 'dotenv/config';
import cron from 'node-cron';
import { pathToFileURL } from 'url';
import { createApp } from './app.js';
import { migrate, get, all } from './db/connection.js';
import { seedCompetitions, seedDemoMatches } from './db/seed.js';
import { syncAllCompetitions, syncAllStandings, syncLiveScores, syncLeagueIds, cleanupTestMatches, autoRecalculateFinishedMatches } from './services/sync.js';
import { dedupeCompetitionMatches } from './lib/matches.js';
import { invertPersistedVenueOverrides } from './lib/matchOverrides.js';
import { scoreChampionBetsForCompetition } from './lib/championBets.js';
import { getCompetitionSeason } from './lib/season.js';
import { sendPredictionReminders, sendMorningReminders, configureWebPush } from './services/notifications.js';
import { assertJwtSecret } from './middleware/auth.js';

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;

function scheduleJobs() {
  cron.schedule('0 */6 * * *', () => {
    syncAllCompetitions()
      .then(() => syncAllStandings())
      .catch(console.error);
  });
  cron.schedule('*/5 * * * *', () => syncLiveScores().catch(console.error));
  cron.schedule('20 * * * *', () => syncAllStandings().catch(console.error));
  const vapid = configureWebPush();
  if (!vapid.ok && process.env.NODE_ENV === 'production') {
    console.warn('⚠️  Push notifications désactivées :', vapid.error);
  }
  cron.schedule('*/5 * * * *', () => {
    sendPredictionReminders()
      .then(r => {
        if (r.count > 0) {
          const sent = r.results.reduce((n, row) => n + (row.push?.sent ?? 0), 0);
          console.log(`Rappels push: ${r.count} cible(s), ${sent} envoyé(s)`);
        }
      })
      .catch(err => console.error('Rappels push:', err.message));
  });

  const morningEnabled = process.env.NOTIFICATION_MORNING_ENABLED !== 'false';
  const morningHour = Number(process.env.NOTIFICATION_MORNING_HOUR ?? 8);
  const morningTz = process.env.NOTIFICATION_MORNING_TZ?.trim() || 'Europe/Paris';
  if (morningEnabled) {
    cron.schedule(`0 ${morningHour} * * *`, () => {
      sendMorningReminders()
        .then(r => console.log(`Rappels matin: ${r.count} cible(s)`))
        .catch(err => console.error('Rappels matin:', err.message));
    }, { timezone: morningTz });
  }
}

async function initData() {
  await migrate();
  await seedCompetitions();
  await cleanupTestMatches();

  try {
    const inverted = await invertPersistedVenueOverrides();
    if (inverted > 0) console.log(`Inversion domicile J1 PSG–Rennes : ${inverted} match(s)`);
  } catch (err) {
    console.warn('Inversion domicile PSG–Rennes échouée :', err.message);
  }

  if (process.env.BSD_API_TOKEN?.trim()) {
    try {
      await syncLeagueIds();
    } catch (err) {
      console.warn('Sync IDs ligues BSD échouée :', err.message);
    }
    try {
      await syncAllCompetitions();
      await syncAllStandings();
      console.log('Sync BSD : calendrier et classements importés');
    } catch (err) {
      console.warn('Sync BSD échouée :', err.message);
    }
  }

  try {
    const recalculated = await autoRecalculateFinishedMatches();
    if (recalculated > 0) console.log(`Pronostics recalculés au démarrage : ${recalculated}`);
  } catch (err) {
    console.warn('Recalcul pronostics échoué :', err.message);
  }

  const matchCount = Number((await get('SELECT COUNT(*) as n FROM matches'))?.n ?? 0);
  if (matchCount === 0 && !process.env.BSD_API_TOKEN?.trim()) {
    await seedDemoMatches();
    console.log('Matchs de démo chargés (BSD indisponible ou vide)');
  }

  const comps = await all('SELECT id FROM competitions');
  let deduped = 0;
  for (const c of comps) {
    deduped += await dedupeCompetitionMatches(c.id);
    try {
      const season = await getCompetitionSeason(c.id);
      await scoreChampionBetsForCompetition(c.id, season);
    } catch (err) {
      console.warn(`Paris vainqueur ligue ${c.id}:`, err.message);
    }
  }
  if (deduped > 0) console.log(`Doublons matchs fusionnés au démarrage : ${deduped}`);
}

async function start() {
  assertJwtSecret();
  try {
    await initData();
    console.log('Base de données prête');
  } catch (err) {
    console.error('Init base de données échouée :', err.message);
    process.exit(1);
  }

  scheduleJobs();
  app.listen(PORT, '0.0.0.0', () => {
    const host = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    console.log(`Matchday démarré sur ${host}`);
  });
}

async function shutdown() {
  const { closeDb } = await import('./db/connection.js');
  await closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  start().catch(err => {
    console.error('Erreur au démarrage:', err);
    process.exit(1);
  });
}

export default app;
export { createApp, start };

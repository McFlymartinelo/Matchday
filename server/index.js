import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { migrate } from './db/connection.js';
import { seedCompetitions, seedDemoMatches } from './db/seed.js';
import { get } from './db/connection.js';
import { syncAllCompetitions, syncAllStandings, syncLiveScores, syncLeagueIds, cleanupTestMatches } from './services/sync.js';

import authRoutes from './routes/auth.js';
import groupRoutes from './routes/groups.js';
import matchRoutes from './routes/matches.js';
import standingsRoutes from './routes/standings.js';
import seasonXiRoutes from './routes/seasonXi.js';
import specialBetsRoutes from './routes/specialBets.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import { sendPredictionReminders, configureWebPush } from './services/notifications.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API
app.get('/api/health', async (_req, res) => {
  try {
    const matchCount = Number((await get('SELECT COUNT(*) as n FROM matches'))?.n ?? 0);
    const upcoming = Number((await get(
      `SELECT COUNT(*) as n FROM matches WHERE kickoff_at >= datetime('now') AND status NOT IN ('finished', 'FT', 'ended')`
    ))?.n ?? 0);
    const lastSync = await get('SELECT sync_type, status, details, created_at FROM sync_log ORDER BY rowid DESC LIMIT 1');
    res.json({
      status: 'ok',
      app: 'Matchday',
      time: new Date().toISOString(),
      matchCount,
      upcomingMatches: upcoming,
      hasBsdToken: !!process.env.BSD_API_TOKEN?.trim(),
      lastSync: lastSync ?? null,
    });
  } catch {
    res.json({ status: 'ok', app: 'Matchday', time: new Date().toISOString() });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/groups', matchRoutes);
app.use('/api/groups', standingsRoutes);
app.use('/api/groups', seasonXiRoutes);
app.use('/api/groups', specialBetsRoutes);
app.use('/api/groups', chatRoutes);
app.use('/api/admin', adminRoutes);

app.post('/api/sync/fixtures', async (req, res) => {
  const secret = process.env.SYNC_SECRET?.trim();
  if (!secret || req.headers['x-sync-secret'] !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!process.env.BSD_API_TOKEN?.trim()) {
    return res.status(400).json({ error: 'BSD_API_TOKEN manquant' });
  }
  try {
    await syncLeagueIds();
    const total = await syncAllCompetitions();
    await syncAllStandings();
    res.json({ ok: true, matchCount: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Frontend statique
app.use(express.static(join(__dirname, '../public')));

app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

function scheduleJobs() {
  cron.schedule('0 */6 * * *', () => syncAllCompetitions().catch(console.error));
  cron.schedule('*/5 * * * *', () => syncLiveScores().catch(console.error));
  cron.schedule('0 6 * * *', () => syncAllStandings().catch(console.error));
  const vapid = configureWebPush();
  if (!vapid.ok && process.env.NODE_ENV === 'production') {
    console.warn('⚠️  Push notifications désactivées :', vapid.error);
  }
  cron.schedule('*/5 * * * *', () => {
    sendPredictionReminders().catch(err => console.error('Rappels push:', err.message));
  });
}

async function initData() {
  await migrate();
  await seedCompetitions();
  await cleanupTestMatches();

  if (process.env.BSD_API_TOKEN?.trim()) {
    try {
      await syncLeagueIds();
      await syncAllCompetitions();
      await syncAllStandings();
      console.log('Sync BSD : calendrier importé');
    } catch (err) {
      console.warn('Sync BSD échouée :', err.message);
    }
  }

  const matchCount = Number((await get('SELECT COUNT(*) as n FROM matches'))?.n ?? 0);
  if (matchCount === 0 && !process.env.BSD_API_TOKEN?.trim()) {
    await seedDemoMatches();
    console.log('Matchs de démo chargés (BSD indisponible ou vide)');
  }
}

async function start() {
  app.listen(PORT, () => {
    const host = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    console.log(`Matchday démarré sur ${host}`);
  });

  scheduleJobs();

  try {
    await initData();
    console.log('Base de données prête');
  } catch (err) {
    console.error('Init base de données échouée :', err.message);
  }
}

start().catch(err => {
  console.error('Erreur au démarrage:', err);
  process.exit(1);
});

async function shutdown() {
  const { closeDb } = await import('./db/connection.js');
  await closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { get } from './db/connection.js';
import { syncAllCompetitions, syncAllStandings, syncLeagueIds } from './services/sync.js';
import { securityHeaders } from './middleware/securityHeaders.js';

import authRoutes from './routes/auth.js';
import groupRoutes from './routes/groups.js';
import matchRoutes from './routes/matches.js';
import standingsRoutes from './routes/standings.js';
import seasonXiRoutes from './routes/seasonXi.js';
import specialBetsRoutes from './routes/specialBets.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(express.json({ limit: '32kb' }));

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

  app.use(express.static(join(__dirname, '../public')));
  app.get('*', (_req, res) => {
    res.sendFile(join(__dirname, '../public/index.html'));
  });

  return app;
}

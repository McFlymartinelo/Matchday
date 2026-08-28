import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-api';
process.env.TEST_DB_PATH = 'data/test-api-security.db';
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { migrate, run, get, closeDb } = await import('../server/db/connection.js');
const { seedCompetitions } = await import('../server/db/seed.js');
const { createApp } = await import('../server/app.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = join(root, process.env.TEST_DB_PATH);

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

async function jsonFetch(base, path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

describe('API — membership, pronos verrouillés, reset public', () => {
  let server;
  let base;
  let userA;
  let groupId;
  let openMatchId;
  let lockedMatchId;

  before(async () => {
    mkdirSync(join(root, 'data'), { recursive: true });
    if (existsSync(dbFile)) unlinkSync(dbFile);
    await migrate();
    await seedCompetitions();

    const hash = await bcrypt.hash('secret1', 10);
    const a = await run(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
      ['alice_api', hash, 'Alice']
    );
    userA = { id: Number(a.lastInsertRowid), username: 'alice_api' };
    await run(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
      ['bob_api', hash, 'Bob']
    );

    const comp = await get("SELECT id FROM competitions WHERE code = 'L1'");
    const g = await run(
      'INSERT INTO groups (name, invite_code, admin_id) VALUES (?, ?, ?)',
      ['Groupe API', 'APISEC1', userA.id]
    );
    groupId = Number(g.lastInsertRowid);
    await run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)', [groupId, userA.id]);
    await run('INSERT INTO group_competitions (group_id, competition_id) VALUES (?, ?)', [groupId, comp.id]);

    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    const open = await run(
      `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name, status, matchday, kickoff_at, season)
       VALUES (?, ?, 'PSG', 'OM', 'scheduled', 1, ?, '2025-2026')`,
      [-91001, comp.id, future]
    );
    const locked = await run(
      `INSERT INTO matches (bsd_event_id, competition_id, home_team_name, away_team_name, status, matchday, kickoff_at, season)
       VALUES (?, ?, 'Lyon', 'Nice', 'scheduled', 1, ?, '2025-2026')`,
      [-91002, comp.id, past]
    );
    openMatchId = Number(open.lastInsertRowid);
    lockedMatchId = Number(locked.lastInsertRowid);

    const app = createApp();
    ({ server, base } = await listen(app));
  });

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    }
    await closeDb();
  });

  async function login(username) {
    const { status, data } = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { username, password: 'secret1' },
    });
    assert.equal(status, 200, data.error);
    return data.token;
  }

  it('refuse le reset de mot de passe public', async () => {
    const { status } = await jsonFetch(base, '/api/auth/reset-password', {
      method: 'POST',
      body: { username: 'alice_api', password: 'hacked1' },
    });
    assert.ok(status === 404 || status === 401 || status === 403);
  });

  it('refuse l’accès aux matchs d’un groupe dont on n’est pas membre', async () => {
    const token = await login('bob_api');
    const { status, data } = await jsonFetch(base, `/api/groups/${groupId}/matches`, { token });
    assert.equal(status, 403);
    assert.match(data.error, /Accès refusé/i);
  });

  it('refuse un pronostic sur un match déjà commencé', async () => {
    const token = await login('alice_api');
    const { status, data } = await jsonFetch(base, `/api/groups/${groupId}/predictions`, {
      method: 'POST',
      token,
      body: { matchId: lockedMatchId, homeScore: 1, awayScore: 0 },
    });
    assert.equal(status, 400);
    assert.match(data.error, /verrouillé/i);
  });

  it('accepte un pronostic sur un match encore ouvert', async () => {
    const token = await login('alice_api');
    const { status, data } = await jsonFetch(base, `/api/groups/${groupId}/predictions`, {
      method: 'POST',
      token,
      body: { matchId: openMatchId, homeScore: 2, awayScore: 1 },
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });

  it('change le mot de passe uniquement avec l’ancien', async () => {
    const token = await login('alice_api');
    const bad = await jsonFetch(base, '/api/auth/change-password', {
      method: 'POST',
      token,
      body: { currentPassword: 'wrong', newPassword: 'secret2' },
    });
    assert.equal(bad.status, 401);

    const ok = await jsonFetch(base, '/api/auth/change-password', {
      method: 'POST',
      token,
      body: { currentPassword: 'secret1', newPassword: 'secret2' },
    });
    assert.equal(ok.status, 200);

    const oldLogin = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { username: 'alice_api', password: 'secret1' },
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { username: 'alice_api', password: 'secret2' },
    });
    assert.equal(newLogin.status, 200);

    await run('UPDATE users SET password_hash = ? WHERE id = ?', [
      await bcrypt.hash('secret1', 10),
      userA.id,
    ]);
  });
});

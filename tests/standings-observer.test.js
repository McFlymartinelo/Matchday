import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-observer';
process.env.TEST_DB_PATH = 'data/test-standings-observer.db';
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { migrate, run, get, closeDb } = await import('../server/db/connection.js');
const { seedCompetitions } = await import('../server/db/seed.js');
const { createApp } = await import('../server/app.js');
const { isStandingsObserver } = await import('../server/lib/standingsVisibility.js');

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

describe('classement — observateur Marty / La cousinade', () => {
  let server;
  let base;
  let martyId;
  let leaId;
  let cousinadeId;
  let copainsId;

  before(async () => {
    mkdirSync(join(root, 'data'), { recursive: true });
    if (existsSync(dbFile)) unlinkSync(dbFile);
    await migrate();
    await seedCompetitions();

    const hash = await bcrypt.hash('secret1', 10);
    const marty = await run(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
      ['marty', hash, 'Marty']
    );
    martyId = Number(marty.lastInsertRowid);
    const lea = await run(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
      ['lea_cousinade', hash, 'Léa']
    );
    leaId = Number(lea.lastInsertRowid);

    const l1 = await get("SELECT id, saison_active FROM competitions WHERE code = 'L1'");
    const cousinade = await run(
      'INSERT INTO groups (name, invite_code, admin_id) VALUES (?, ?, ?)',
      ['La cousinade', 'COUSIN01', martyId]
    );
    cousinadeId = Number(cousinade.lastInsertRowid);
    const copains = await run(
      'INSERT INTO groups (name, invite_code, admin_id) VALUES (?, ?, ?)',
      ['Les copains', 'COPAINS1', martyId]
    );
    copainsId = Number(copains.lastInsertRowid);

    await run(
      'INSERT INTO group_members (group_id, user_id) VALUES (?, ?), (?, ?), (?, ?), (?, ?)',
      [cousinadeId, martyId, cousinadeId, leaId, copainsId, martyId, copainsId, leaId]
    );
    await run(
      'INSERT INTO group_competitions (group_id, competition_id) VALUES (?, ?), (?, ?)',
      [cousinadeId, l1.id, copainsId, l1.id]
    );
    await run(
      `INSERT INTO special_bets (user_id, group_id, competition_id, season, bet_type, bet_value)
       VALUES (?, ?, ?, ?, 'champion', 'PSG'), (?, ?, ?, ?, 'champion', 'OM')`,
      [martyId, cousinadeId, l1.id, l1.saison_active, leaId, cousinadeId, l1.id, l1.saison_active]
    );

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

  it('reconnaît Marty dans La cousinade comme observateur', () => {
    assert.equal(isStandingsObserver('Marty', 'La cousinade'), true);
    assert.equal(isStandingsObserver('marty', 'LA COUSINADE'), true);
    assert.equal(isStandingsObserver('marty', 'Les copains'), false);
    assert.equal(isStandingsObserver('lea_cousinade', 'La cousinade'), false);
  });

  it('reste membre du groupe mais n’apparaît pas au classement', async () => {
    const token = await login('lea_cousinade');
    const members = await jsonFetch(base, `/api/groups/${cousinadeId}`, { token });
    assert.equal(members.status, 200);
    assert.ok(members.data.members.some(m => Number(m.id) === martyId));

    const standings = await jsonFetch(base, `/api/groups/${cousinadeId}/standings`, { token });
    assert.equal(standings.status, 200);
    assert.equal(standings.data.some(r => Number(r.userId) === martyId), false);
    assert.ok(standings.data.some(r => Number(r.userId) === leaId));
    assert.equal(standings.data.find(r => Number(r.userId) === leaId)?.rank, 1);
  });

  it('laisse Marty consulter le groupe et son profil observateur', async () => {
    const token = await login('marty');
    const standings = await jsonFetch(base, `/api/groups/${cousinadeId}/standings`, { token });
    assert.equal(standings.status, 200);
    assert.equal(standings.data.some(r => Number(r.userId) === martyId), false);

    const analytics = await jsonFetch(base, `/api/groups/${cousinadeId}/analytics`, { token });
    assert.equal(analytics.status, 200);
    assert.equal(analytics.data.members.some(m => Number(m.userId) === martyId), false);

    const history = await jsonFetch(base, `/api/groups/${cousinadeId}/standings/history`, { token });
    assert.equal(history.status, 200);
    assert.equal(history.data.participants.some(p => Number(p.userId) === martyId), false);

    const profile = await jsonFetch(base, `/api/groups/${cousinadeId}/profile`, { token });
    assert.equal(profile.status, 200);
    assert.equal(profile.data.excludeFromStandings, true);
    assert.equal(profile.data.rank, null);
    assert.equal(profile.data.memberCount, 1);

    const winners = await jsonFetch(base, `/api/groups/${cousinadeId}/special-bets/group`, { token });
    assert.equal(winners.status, 200);
    assert.equal(winners.data.members.some(m => Number(m.userId) === martyId), false);
    assert.ok(winners.data.members.some(m => Number(m.userId) === leaId));
    assert.equal(winners.data.bets.some(b => Number(b.userId) === martyId), false);
  });

  it('compte Marty dans le classement des autres groupes', async () => {
    const token = await login('marty');
    const standings = await jsonFetch(base, `/api/groups/${copainsId}/standings`, { token });
    assert.equal(standings.status, 200);
    assert.ok(standings.data.some(r => Number(r.userId) === martyId));
    assert.ok(standings.data.some(r => Number(r.userId) === leaId));

    const profile = await jsonFetch(base, `/api/groups/${copainsId}/profile`, { token });
    assert.equal(profile.status, 200);
    assert.equal(profile.data.excludeFromStandings, false);
    assert.ok(profile.data.rank >= 1);
  });
});

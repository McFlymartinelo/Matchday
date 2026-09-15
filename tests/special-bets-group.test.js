import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-special-bets';
process.env.TEST_DB_PATH = 'data/test-special-bets-group.db';
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

describe('API — pronos vainqueur du groupe', () => {
  let server;
  let base;
  let aliceId;
  let charlieId;
  let groupId;
  let l1Id;
  let season;

  before(async () => {
    mkdirSync(join(root, 'data'), { recursive: true });
    if (existsSync(dbFile)) unlinkSync(dbFile);
    await migrate();
    await seedCompetitions();

    const hash = await bcrypt.hash('secret1', 10);
    const alice = await run(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
      ['alice_winners', hash, 'Alice']
    );
    aliceId = Number(alice.lastInsertRowid);
    const charlie = await run(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
      ['charlie_winners', hash, 'Charlie']
    );
    charlieId = Number(charlie.lastInsertRowid);
    await run(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
      ['bob_winners', hash, 'Bob']
    );

    const l1 = await get("SELECT id, saison_active FROM competitions WHERE code = 'L1'");
    l1Id = l1.id;
    season = l1.saison_active;

    const g = await run(
      'INSERT INTO groups (name, invite_code, admin_id) VALUES (?, ?, ?)',
      ['Groupe vainqueurs', 'WINNERS1', aliceId]
    );
    groupId = Number(g.lastInsertRowid);
    await run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?), (?, ?)', [groupId, aliceId, groupId, charlieId]);
    await run('INSERT INTO group_competitions (group_id, competition_id) VALUES (?, ?)', [groupId, l1Id]);

    await run(
      `INSERT INTO special_bets (user_id, group_id, competition_id, season, bet_type, bet_value)
       VALUES (?, ?, ?, ?, 'champion', 'PSG'), (?, ?, ?, ?, 'champion', 'OM')`,
      [aliceId, groupId, l1Id, season, charlieId, groupId, l1Id, season]
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

  it('refuse l’accès à un non-membre', async () => {
    const token = await login('bob_winners');
    const { status, data } = await jsonFetch(base, `/api/groups/${groupId}/special-bets/group`, { token });
    assert.equal(status, 403);
    assert.match(data.error, /Accès refusé/i);
  });

  it('renvoie les membres et les pronos du groupe', async () => {
    const token = await login('alice_winners');
    const { status, data } = await jsonFetch(base, `/api/groups/${groupId}/special-bets/group`, { token });
    assert.equal(status, 200, data.error);
    assert.equal(data.members[0].userId, aliceId);
    assert.equal(data.members.length, 2);
    assert.ok(data.competitions.some(c => c.code === 'L1'));

    const own = data.bets.find(b => b.userId === aliceId && b.competitionId === l1Id);
    assert.equal(own?.betValue, 'PSG');

    const l1 = data.competitions.find(c => c.code === 'L1');
    const charlieBet = data.bets.find(b => b.userId === charlieId && b.competitionId === l1Id);
    if (l1.revealed) {
      assert.equal(charlieBet?.betValue, 'OM');
    } else {
      assert.equal(charlieBet, undefined);
    }
  });

  it('ne mélange pas les pronos perso avec ceux du groupe', async () => {
    const token = await login('alice_winners');
    const { status, data } = await jsonFetch(base, `/api/groups/${groupId}/special-bets`, { token });
    assert.equal(status, 200);
    assert.equal(data.length, 1);
    assert.equal(data[0].betValue, 'PSG');
  });
});

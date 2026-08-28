import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-otp';
process.env.TEST_DB_PATH = 'data/test-auth-otp.db';
process.env.AUTH_OTP_RESEND_MS = '0';
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SMTP_URL;
delete process.env.SMTP_HOST;

const { migrate, closeDb } = await import('../server/db/connection.js');
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

describe('Auth — email + OTP', () => {
  let server;
  let base;

  before(async () => {
    mkdirSync(join(root, 'data'), { recursive: true });
    if (existsSync(dbFile)) unlinkSync(dbFile);
    await migrate();
    const app = createApp();
    ({ server, base } = await listen(app));
  });

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    }
    await closeDb();
  });

  it('refuse une inscription sans email', async () => {
    const { status, data } = await jsonFetch(base, '/api/auth/register', {
      method: 'POST',
      body: { username: 'noemail', password: 'secret1' },
    });
    assert.equal(status, 400);
    assert.match(data.error, /mail/i);
  });

  it('inscrit, exige un OTP, puis connecte', async () => {
    const registered = await jsonFetch(base, '/api/auth/register', {
      method: 'POST',
      body: { username: 'marie', password: 'secret1', email: 'marie@example.com' },
    });
    assert.equal(registered.status, 201, registered.data.error);
    assert.equal(registered.data.needsOtp, true);
    assert.equal(registered.data.channel, 'email');
    assert.ok(registered.data.otpToken);
    assert.ok(registered.data.devOtp);
    assert.match(registered.data.emailMasked, /m\*\*\*@example\.com/);

    const wrong = registered.data.devOtp === '0000' ? '1111' : '0000';
    const bad = await jsonFetch(base, '/api/auth/verify-otp', {
      method: 'POST',
      body: { otpToken: registered.data.otpToken, code: wrong },
    });
    assert.equal(bad.status, 400);

    const ok = await jsonFetch(base, '/api/auth/verify-otp', {
      method: 'POST',
      body: { otpToken: registered.data.otpToken, code: registered.data.devOtp },
    });
    assert.equal(ok.status, 200, ok.data.error);
    assert.ok(ok.data.token);
    assert.equal(ok.data.user.email, 'marie@example.com');
    assert.equal(ok.data.user.emailVerified, true);

    const me = await jsonFetch(base, '/api/auth/me', { token: ok.data.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.email, 'marie@example.com');
  });

  it('refuse un email déjà pris', async () => {
    const { status } = await jsonFetch(base, '/api/auth/register', {
      method: 'POST',
      body: { username: 'other', password: 'secret1', email: 'marie@example.com' },
    });
    assert.equal(status, 409);
  });

  it('accepte la connexion par email puis OTP', async () => {
    const login = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { username: 'marie@example.com', password: 'secret1' },
    });
    assert.equal(login.status, 200, login.data.error);
    assert.equal(login.data.needsOtp, true);
    assert.ok(login.data.devOtp);

    const verified = await jsonFetch(base, '/api/auth/verify-otp', {
      method: 'POST',
      body: { otpToken: login.data.otpToken, code: login.data.devOtp },
    });
    assert.equal(verified.status, 200, verified.data.error);
    assert.ok(verified.data.token);
  });

  it('renvoie un nouveau code OTP', async () => {
    const login = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { username: 'marie', password: 'secret1' },
    });
    const first = login.data.devOtp;
    const resent = await jsonFetch(base, '/api/auth/resend-otp', {
      method: 'POST',
      body: { otpToken: login.data.otpToken },
    });
    assert.equal(resent.status, 200, resent.data.error);
    assert.ok(resent.data.devOtp);
    assert.notEqual(resent.data.devOtp, first);
  });
});

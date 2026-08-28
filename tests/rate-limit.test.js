import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../server/middleware/rateLimit.js';
import { assertJwtSecret } from '../server/middleware/auth.js';

function mockReq(ip = '127.0.0.1') {
  return { ip, socket: { remoteAddress: ip } };
}

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

describe('rateLimit', () => {
  it('laisse passer sous le plafond puis répond 429', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 2 });
    let nextCount = 0;
    const next = () => { nextCount += 1; };

    mw(mockReq(), mockRes(), next);
    mw(mockReq(), mockRes(), next);
    assert.equal(nextCount, 2);

    const blocked = mockRes();
    mw(mockReq(), blocked, next);
    assert.equal(blocked.statusCode, 429);
    assert.equal(nextCount, 2);
    assert.match(blocked.body.error, /Trop de tentatives/i);
  });

  it('compte les IP séparément', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1 });
    let nextCount = 0;
    mw(mockReq('1.1.1.1'), mockRes(), () => { nextCount += 1; });
    mw(mockReq('2.2.2.2'), mockRes(), () => { nextCount += 1; });
    assert.equal(nextCount, 2);
  });
});

describe('assertJwtSecret', () => {
  it('refuse un secret faible en production', () => {
    const prevN = process.env.NODE_ENV;
    const prevS = process.env.JWT_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'dev-secret';
      assert.throws(() => assertJwtSecret(), /JWT_SECRET/);
    } finally {
      process.env.NODE_ENV = prevN;
      process.env.JWT_SECRET = prevS;
    }
  });

  it('accepte un secret en développement', () => {
    const prevN = process.env.NODE_ENV;
    const prevS = process.env.JWT_SECRET;
    try {
      process.env.NODE_ENV = 'development';
      delete process.env.JWT_SECRET;
      assert.doesNotThrow(() => assertJwtSecret());
    } finally {
      process.env.NODE_ENV = prevN;
      process.env.JWT_SECRET = prevS;
    }
  });
});

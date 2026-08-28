import 'dotenv/config';
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let client;
let sqliteConfigured = false;

export function getDb() {
  if (client) return client;

  if (process.env.TEST_DB_PATH) {
    const dataDir = join(__dirname, '../../data');
    mkdirSync(dataDir, { recursive: true });
    const dbFile = join(__dirname, '../..', process.env.TEST_DB_PATH);
    client = createClient({ url: `file:${dbFile}` });
  } else if (process.env.TURSO_DATABASE_URL) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  } else {
    const dataDir = join(__dirname, '../../data');
    mkdirSync(dataDir, { recursive: true });
    client = createClient({ url: `file:${join(dataDir, 'matchday.db')}` });
  }
  return client;
}

async function configureSqlite() {
  if (sqliteConfigured || (process.env.TURSO_DATABASE_URL && !process.env.TEST_DB_PATH)) return;
  sqliteConfigured = true;
  const db = getDb();
  await db.execute('PRAGMA journal_mode = WAL');
  await db.execute('PRAGMA busy_timeout = 8000');
  await db.execute('PRAGMA synchronous = NORMAL');
}

function isBusyError(err) {
  return err?.code === 'SQLITE_BUSY' || err?.rawCode === 5;
}

export async function run(sql, params = []) {
  await configureSqlite();
  const db = getDb();
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await db.execute({ sql, args: params });
    } catch (err) {
      if (isBusyError(err) && attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 150 * attempt));
        continue;
      }
      throw err;
    }
  }
}

export async function get(sql, params = []) {
  const result = await run(sql, params);
  return result.rows[0] ?? null;
}

export async function all(sql, params = []) {
  const result = await run(sql, params);
  return result.rows;
}

export async function migrate() {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  const statements = schema.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await run(stmt);
  }
  await ensureMatchColumns();
  await ensureOtpSchema();
}

async function ensureMatchColumns() {
  await addColumnIfMissing('matches', 'home_bsd_team_id', 'INTEGER');
  await addColumnIfMissing('matches', 'away_bsd_team_id', 'INTEGER');
  await addColumnIfMissing('season_xi', 'formation', "TEXT DEFAULT '433'");
  await addColumnIfMissing('season_xi_players', 'slot_id', 'TEXT');
  await addColumnIfMissing('season_xi_players', 'natural_position', 'TEXT');
  await addColumnIfMissing('official_standings', 'zone_key', 'TEXT');
  await addColumnIfMissing('official_standings', 'zone_label', 'TEXT');
  await addColumnIfMissing('official_standings', 'zone_type', 'TEXT');
  await addColumnIfMissing('users', 'email', 'TEXT');
  await addColumnIfMissing('users', 'email_verified', 'INTEGER DEFAULT 0');
  try {
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL');
  } catch { /* index déjà présent ou non supporté */ }
}

async function ensureOtpSchema() {
  const cols = await all('PRAGMA table_info(email_otps)');
  if (!cols.length) return;

  await addColumnIfMissing('email_otps', 'email', 'TEXT');
  const refreshed = await all('PRAGMA table_info(email_otps)');
  const userIdCol = refreshed.find(c => c.name === 'user_id');
  const notNull = Number(userIdCol?.notnull || 0) === 1;
  if (!notNull) {
    try {
      await run('CREATE INDEX IF NOT EXISTS idx_email_otps_email ON email_otps(email, purpose)');
    } catch { /* index déjà présent */ }
    return;
  }

  await run('DROP TABLE IF EXISTS email_otps_v2');
  await run(`CREATE TABLE email_otps_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await run(`INSERT INTO email_otps_v2 (id, user_id, email, purpose, code_hash, expires_at, attempts, created_at)
    SELECT o.id, o.user_id, COALESCE(NULLIF(o.email, ''), u.email, 'unknown@invalid'),
           o.purpose, o.code_hash, o.expires_at, o.attempts, o.created_at
    FROM email_otps o
    LEFT JOIN users u ON u.id = o.user_id`);
  await run('DROP TABLE email_otps');
  await run('ALTER TABLE email_otps_v2 RENAME TO email_otps');
  await run('CREATE INDEX IF NOT EXISTS idx_email_otps_user ON email_otps(user_id, purpose)');
  await run('CREATE INDEX IF NOT EXISTS idx_email_otps_email ON email_otps(email, purpose)');
}

async function addColumnIfMissing(table, column, type) {
  const cols = await all(`PRAGMA table_info(${table})`);
  if (cols.some(c => c.name === column)) return;
  try {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err) {
    if (!/duplicate column/i.test(String(err.message))) throw err;
  }
}

export async function closeDb() {
  if (client) {
    client.close();
    client = null;
  }
}

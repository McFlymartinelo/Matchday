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

  if (process.env.TURSO_DATABASE_URL) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  } else {
    const dataDir = join(__dirname, '../../data');
    mkdirSync(dataDir, { recursive: true });
    const dbFile = process.env.TEST_DB_PATH
      ? join(__dirname, '../..', process.env.TEST_DB_PATH)
      : join(dataDir, 'matchday.db');
    client = createClient({ url: `file:${dbFile}` });
  }
  return client;
}

async function configureSqlite() {
  if (sqliteConfigured || process.env.TURSO_DATABASE_URL) return;
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
}

async function ensureMatchColumns() {
  await addColumnIfMissing('matches', 'home_bsd_team_id', 'INTEGER');
  await addColumnIfMissing('matches', 'away_bsd_team_id', 'INTEGER');
  await addColumnIfMissing('season_xi', 'formation', "TEXT DEFAULT '433'");
  await addColumnIfMissing('season_xi_players', 'slot_id', 'TEXT');
  await addColumnIfMissing('season_xi_players', 'natural_position', 'TEXT');
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

/**
 * Liste et suppression de groupes Matchday.
 *
 * Usage:
 *   npm run admin:groups
 *   npm run admin:delete-group -- 4
 *   npm run admin:delete-group -- "Groupe API"
 */
import 'dotenv/config';
import { migrate, get, run, all } from '../server/db/connection.js';

function dbLabel() {
  if (process.env.TURSO_DATABASE_URL?.trim()) {
    const host = process.env.TURSO_DATABASE_URL.replace(/^libsql:\/\//, '').split('.')[0];
    return `Turso (${host || 'remote'})`;
  }
  return 'SQLite local (data/matchday.db)';
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function tryRun(sql, params) {
  try {
    await run(sql, params);
  } catch (err) {
    if (!/no such table/i.test(String(err.message))) throw err;
  }
}

async function listGroups() {
  const groups = await all(`
    SELECT g.id, g.name, g.invite_code, g.is_public, u.username AS admin,
           (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS members
    FROM groups g
    JOIN users u ON u.id = g.admin_id
    ORDER BY g.id
  `);

  console.log('\n🏟️  Groupes\n');
  if (!groups.length) {
    console.log('  (aucun)\n');
    return;
  }
  for (const g of groups) {
    const vis = g.is_public ? 'public' : 'privé';
    console.log(`  ${g.id}. ${g.name} — admin @${g.admin} — ${g.members} membre(s) — ${vis} — code ${g.invite_code}`);
  }
  console.log('');
}

async function deleteGroup(group) {
  const id = group.id;
  await tryRun(
    `DELETE FROM prediction_reactions WHERE prediction_id IN (
      SELECT id FROM predictions WHERE group_id = ?
    )`,
    [id]
  );
  await tryRun(
    `DELETE FROM chat_reactions WHERE message_id IN (
      SELECT id FROM chat_messages WHERE group_id = ?
    )`,
    [id]
  );
  await tryRun('DELETE FROM chat_messages WHERE group_id = ?', [id]);
  await tryRun('DELETE FROM season_xi_points WHERE group_id = ?', [id]);
  await tryRun('DELETE FROM season_xi WHERE group_id = ?', [id]);
  await tryRun('DELETE FROM special_bets WHERE group_id = ?', [id]);
  await tryRun('DELETE FROM predictions WHERE group_id = ?', [id]);
  await tryRun('DELETE FROM group_competitions WHERE group_id = ?', [id]);
  await tryRun('DELETE FROM group_members WHERE group_id = ?', [id]);
  await run('DELETE FROM groups WHERE id = ?', [id]);
  console.log(`\n✅ Groupe « ${group.name} » (id ${id}) supprimé de ${dbLabel()}\n`);
}

async function resolveGroup(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    return get(
      `SELECT g.id, g.name FROM groups g WHERE g.id = ?`,
      [Number(value)]
    );
  }
  return get('SELECT id, name FROM groups WHERE name = ? COLLATE NOCASE', [value]);
}

function printHelp() {
  console.log(`
Groupes Matchday

  npm run admin:groups
  npm run admin:delete-group -- 4
  npm run admin:delete-group -- "Groupe API"
`);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

await migrate();
console.log(`🗄️  Base ciblée : ${dbLabel()}\n`);

const deleteArg = argValue('--delete');
const positional = args.find(a => !a.startsWith('-'));
const wantDelete = args.includes('--delete') || process.argv[1]?.includes('delete-group');

if (wantDelete && (deleteArg || positional)) {
  const group = await resolveGroup(deleteArg && !deleteArg.startsWith('-') ? deleteArg : positional);
  if (!group) {
    console.error('❌ Groupe introuvable. Lance : npm run admin:groups\n');
    process.exit(1);
  }
  await deleteGroup(group);
  process.exit(0);
}

if (wantDelete) {
  console.error('❌ Id ou nom requis : npm run admin:delete-group -- 4\n');
  process.exit(1);
}

await listGroups();

/**
 * Promouvoit ou révoque le rôle admin application (is_admin).
 *
 * Usage:
 *   npm run admin:promote -- marty
 *   npm run admin:promote -- --username marty
 *   npm run admin:promote -- --list
 *   npm run admin:promote -- --revoke marty
 *   npm run admin:promote -- --delete martytest
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

function printDbTarget() {
  console.log(`🗄️  Base ciblée : ${dbLabel()}`);
  if (!process.env.TURSO_DATABASE_URL?.trim()) {
    console.log('   (Pour la prod, renseigne TURSO_DATABASE_URL et TURSO_AUTH_TOKEN dans .env)\n');
  } else {
    console.log('');
  }
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function printHelp() {
  console.log(`
Promouvoir un utilisateur admin Matchday

Options:
  --username <name>   Pseudo à promouvoir (prioritaire)
  --revoke            Retire le rôle admin au lieu de l'accorder
  --delete <name>     Supprime le compte (pronos, groupes, etc.)
  --force             Avec --delete : cède l’admin des groupes à un autre membre
                      (ou supprime le groupe s’il n’a plus personne)
  --list              Liste les utilisateurs et leur statut admin
  --help              Affiche cette aide

Exemples:
  npm run admin:promote -- marty
  npm run admin:promote -- --username marty
  npm run admin:promote -- --revoke marty
  npm run admin:promote -- --delete martytest
  npm run admin:delete -- alice_api --force
  npm run admin:promote -- --list

Note: reconnecte-toi dans l'app après promotion pour obtenir un token admin.
`);
}

async function listUsers() {
  const users = await all(
    'SELECT id, username, display_name, is_admin, created_at FROM users ORDER BY id'
  );

  console.log('\n👥 Utilisateurs\n');
  for (const u of users) {
    const badge = u.is_admin ? 'admin app' : 'utilisateur';
    console.log(`  ${u.id}. ${u.display_name} (@${u.username}) — ${badge}`);
  }
  console.log('');
}

async function tryRun(sql, params) {
  try {
    await run(sql, params);
  } catch (err) {
    if (!/no such table/i.test(String(err.message))) throw err;
  }
}

async function deleteUser(user, { force = false } = {}) {
  const owned = await all('SELECT id, name FROM groups WHERE admin_id = ?', [user.id]);
  for (const g of owned) {
    const other = await get(
      'SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ? LIMIT 1',
      [g.id, user.id]
    );
    if (other) {
      if (!force) {
        console.error(`❌ @${user.username} est admin du groupe « ${g.name} » (id ${g.id}).`);
        console.error('   Passe --force pour céder l’admin à un autre membre, puis supprimer le compte.\n');
        console.error('   Exemple : npm run admin:delete -- alice_api --force\n');
        process.exit(1);
      }
      await run('UPDATE groups SET admin_id = ? WHERE id = ?', [other.user_id, g.id]);
      const next = await get('SELECT username FROM users WHERE id = ?', [other.user_id]);
      console.log(`↪  Groupe « ${g.name} » : admin transféré à @${next?.username || other.user_id}`);
      continue;
    }
    if (!force) {
      console.error(`❌ @${user.username} est le seul membre / admin de « ${g.name} » (id ${g.id}).`);
      console.error('   Passe --force pour supprimer ce groupe avec le compte.\n');
      process.exit(1);
    }
    await tryRun('DELETE FROM group_members WHERE group_id = ?', [g.id]);
    await run('DELETE FROM groups WHERE id = ?', [g.id]);
    console.log(`↪  Groupe « ${g.name} » supprimé (plus aucun membre)`);
  }

  await tryRun(
    `DELETE FROM prediction_reactions WHERE user_id = ? OR prediction_id IN (
      SELECT id FROM predictions WHERE user_id = ?
    )`,
    [user.id, user.id]
  );
  await tryRun('DELETE FROM chat_reactions WHERE user_id = ?', [user.id]);
  await tryRun('DELETE FROM chat_messages WHERE user_id = ?', [user.id]);
  await tryRun('DELETE FROM notification_log WHERE user_id = ?', [user.id]);
  await tryRun('DELETE FROM push_subscriptions WHERE user_id = ?', [user.id]);
  await tryRun('DELETE FROM email_otps WHERE user_id = ?', [user.id]);
  await tryRun('DELETE FROM season_xi_points WHERE user_id = ?', [user.id]);
  await tryRun('DELETE FROM season_xi WHERE user_id = ?', [user.id]);
  await tryRun('DELETE FROM special_bets WHERE user_id = ?', [user.id]);
  await tryRun('DELETE FROM predictions WHERE user_id = ?', [user.id]);
  await tryRun('DELETE FROM group_members WHERE user_id = ?', [user.id]);
  await run('DELETE FROM users WHERE id = ?', [user.id]);

  console.log(`\n✅ Compte @${user.username} supprimé de ${dbLabel()}\n`);
}

function resolveUsername(args) {
  const fromFlag = argValue('--username');
  if (fromFlag) return fromFlag.toLowerCase();

  const positional = args.find(a => !a.startsWith('-'));
  if (positional) return positional.toLowerCase();

  return null;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

await migrate();
printDbTarget();

if (args.includes('--list')) {
  await listUsers();
  process.exit(0);
}

const deleteName = argValue('--delete');
if (args.includes('--delete')) {
  const username = (deleteName || resolveUsername(args.filter(a => a !== '--delete')))?.toLowerCase();
  if (!username) {
    console.error('❌ Pseudo requis : npm run admin:promote -- --delete martytest\n');
    process.exit(1);
  }
  const user = await get(
    'SELECT id, username, display_name FROM users WHERE username = ?',
    [username]
  );
  if (!user) {
    console.error(`❌ Utilisateur @${username} introuvable dans ${dbLabel()}\n`);
    process.exit(1);
  }
  await deleteUser(user, { force: args.includes('--force') });
  process.exit(0);
}

const username = resolveUsername(args);
if (!username) {
  console.error('❌ Pseudo requis.\n');
  printHelp();
  process.exit(1);
}

const user = await get(
  'SELECT id, username, display_name, is_admin FROM users WHERE username = ?',
  [username]
);

if (!user) {
  console.error(`❌ Utilisateur @${username} introuvable dans ${dbLabel()}`);
  console.log('💡 Lance : npm run admin:promote -- --list');
  if (!process.env.TURSO_DATABASE_URL?.trim()) {
    console.log('💡 Marty est peut-être sur la prod — ajoute les variables Turso dans .env\n');
  } else {
    console.log('');
  }
  process.exit(1);
}

const revoke = args.includes('--revoke');
const nextAdmin = revoke ? 0 : 1;

if (!!user.is_admin === !!nextAdmin) {
  const state = nextAdmin ? 'déjà admin app' : 'n\'est pas admin app';
  console.log(`ℹ️  @${user.username} ${state} — rien à faire\n`);
  process.exit(0);
}

await run('UPDATE users SET is_admin = ? WHERE id = ?', [nextAdmin, user.id]);

const action = revoke ? 'révoqué' : 'promu admin app';
console.log(`\n✅ ${user.display_name} (@${user.username}) ${action}`);
console.log('   Reconnecte-toi dans l\'app pour rafraîchir le token JWT.\n');

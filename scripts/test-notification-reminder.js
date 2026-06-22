/**
 * Simule un match dans ~1h sans pronostic et déclenche le rappel push.
 *
 * Usage:
 *   npm run vapid:keys                            # une fois, copier dans .env
 *   npm run test:notifications                    # dry-run (affiche les cibles)
 *   npm run test:notifications -- --send          # envoie les push réels
 *   npm run test:notifications -- --list            # liste utilisateurs / abonnements
 *   npm run test:notifications -- --send --username marty --minutes 60
 *   npm run test:notifications -- --send --keep   # garde le match test en base
 */
import 'dotenv/config';
import { pathToFileURL } from 'url';
import { migrate } from '../server/db/connection.js';
import {
  configureWebPush,
  seedTestReminderMatch,
  sendPredictionReminders,
  findPendingReminderTargets,
  cleanupTestReminderMatch,
} from '../server/services/notifications.js';
import { all, get } from '../server/db/connection.js';

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (!isMain) {
  // Évite l'exécution quand le fichier est chargé par node --test
} else {

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function printHelp() {
  console.log(`
Test rappel pronostic Matchday

Options:
  --list              Liste les utilisateurs et leurs abonnements push
  --send              Envoie les notifications push (sinon simulation)
  --keep              Ne supprime pas le match test après exécution
  --user <id>         ID utilisateur (défaut: 1)
  --username <name>   Nom de connexion (ex. marty) — prioritaire sur --user
  --group <id>        ID du groupe (optionnel — auto si omis)
  --minutes <n>       Coup d'envoi dans N minutes (défaut: 60)
  --help              Affiche cette aide

Exemples:
  npm run test:notifications
  npm run test:notifications -- --send --username marty
  npm run test:notifications -- --send --user 2 --group 1 --minutes 60 --keep
`);
}

function dbLabel() {
  if (process.env.TURSO_DATABASE_URL?.trim()) {
    const host = process.env.TURSO_DATABASE_URL.replace(/^libsql:\/\//, '').split('.')[0];
    return `Turso (${host || 'remote'})`;
  }
  return 'SQLite local (data/matchday.db)';
}

async function resolveGroupId(userId, explicitGroupId) {
  const raw = explicitGroupId ? Number(explicitGroupId) : null;
  const groups = await all(
    `SELECT g.id, g.name FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = ?
     ORDER BY g.id ASC`,
    [userId]
  );

  if (!groups.length) {
    throw new Error('Aucun groupe pour cet utilisateur');
  }

  if (raw) {
    const match = groups.find(g => g.id === raw);
    if (!match) {
      const available = groups.map(g => `#${g.id} ${g.name}`).join(', ');
      throw new Error(`Groupe ${raw} introuvable — groupes disponibles : ${available}`);
    }
    return match;
  }

  return groups[0];
}

async function listUsers() {
  const users = await all(`
    SELECT u.id, u.username, u.display_name,
           (SELECT COUNT(*) FROM push_subscriptions ps WHERE ps.user_id = u.id) AS push_count
    FROM users u
    ORDER BY u.id
  `);

  console.log('\n👥 Utilisateurs\n');
  for (const u of users) {
    const memberships = await all(
      `SELECT g.id, g.name FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?`,
      [u.id]
    );
    const groups = memberships.map(g => `#${g.id} ${g.name}`).join(', ') || '—';
    console.log(`  ${u.id}. ${u.display_name} (@${u.username})`);
    console.log(`     Push: ${u.push_count} · Groupes: ${groups}`);
  }
  console.log('');
}

async function resolveUser({ userId, username }) {
  if (username) {
    const user = await get(
      'SELECT id, username, display_name FROM users WHERE username = ?',
      [username.toLowerCase()]
    );
    if (!user) throw new Error(`Utilisateur @${username} introuvable`);
    return user;
  }

  const user = await get('SELECT id, username, display_name FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error(`Utilisateur id=${userId} introuvable`);
  return user;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const send = args.includes('--send');
const keep = args.includes('--keep');
const list = args.includes('--list');
const username = argValue('--username');
const userId = Number(argValue('--user') ?? 1);
const minutes = Number(argValue('--minutes') ?? 60);
const groupArg = argValue('--group');

await migrate();

if (list) {
  console.log(`🗄️  Base ciblée : ${dbLabel()}\n`);
  await listUsers();
  process.exit(0);
}

console.log('\n📋 Test rappel pronostic Matchday\n');
console.log(`🗄️  Base ciblée : ${dbLabel()}\n`);

let user;
try {
  user = await resolveUser({ userId, username });
} catch (err) {
  console.error(`❌ ${err.message}`);
  console.log('💡 Lance : npm run test:notifications -- --list\n');
  process.exit(1);
}

const subs = await all('SELECT id, endpoint FROM push_subscriptions WHERE user_id = ?', [user.id]);
console.log(`👤 ${user.display_name} (@${user.username})`);
console.log(`📱 Abonnements push enregistrés : ${subs.length}`);

let group;
try {
  group = await resolveGroupId(user.id, groupArg);
} catch (err) {
  console.error(`❌ ${err.message}`);
  console.log('💡 Lance : npm run test:notifications -- --list\n');
  process.exit(1);
}
if (!groupArg && group) {
  console.log(`👥 Groupe auto : #${group.id} ${group.name}`);
}

const vapid = configureWebPush();
if (!vapid.ok) {
  console.warn(`⚠️  ${vapid.error}`);
  console.warn('   Lance : npm run vapid:keys\n');
}

const seeded = await seedTestReminderMatch({ userId: user.id, groupId: group.id, minutes });
console.log(`⚽ Match test créé (#${seeded.matchId})`);
console.log(`   ${seeded.home} vs ${seeded.away}`);
console.log(`   Coup d'envoi : ${seeded.kickoff} (dans ~${minutes} min)`);
console.log(`   Groupe #${group.id} ${group.name} — aucun pronostic pour cet utilisateur\n`);

const targets = await findPendingReminderTargets({ userId: user.id, minutes, windowMinutes: 10 });
console.log(`🎯 Cibles rappel (fenêtre ${minutes}±10 min) : ${targets.length}`);
targets.forEach(t => {
  console.log(`   • ${t.home_team_name} vs ${t.away_team_name} → user ${t.user_id} (${t.group_name})`);
});

if (!send) {
  console.log('\n💡 Mode simulation. Pour envoyer les push :');
  console.log(`   npm run test:notifications -- --send --username ${user.username}\n`);
  console.log('📌 Côté navigateur :');
  console.log('   1. Ouvre l\'app et connecte-toi avec ce compte');
  console.log('   2. Clique sur la cloche 🔔 pour activer les notifications');
  console.log('   3. Relance avec --send\n');
  if (!keep) await cleanupTestReminderMatch();
  process.exit(0);
}

if (!vapid.ok) {
  console.error('\n❌ Impossible d\'envoyer sans clés VAPID');
  if (!keep) await cleanupTestReminderMatch();
  process.exit(1);
}

if (subs.length === 0) {
  console.warn('\n⚠️  Aucun abonnement push — active la cloche 🔔 dans l\'app d\'abord');
}

const result = await sendPredictionReminders({ userId: user.id, minutes, windowMinutes: 10 });
console.log(`\n📤 Notifications traitées : ${result.count}`);
for (const r of result.results) {
  const push = r.push ?? {};
  console.log(`   ✓ ${r.home_team_name} vs ${r.away_team_name}`);
  console.log(`     Push envoyés: ${push.sent ?? 0}, échecs: ${push.failed ?? 0}`);
  if (push.skipped) console.log(`     (${push.reason})`);
  if (push.errors?.length) {
    push.errors.forEach(e => console.log(`     ⚠ ${e.status}: ${e.message}`));
  }
}

if (!keep) {
  console.log('\n⏳ Match test conservé 3 min pour tester le clic sur la notif...');
  await new Promise(r => setTimeout(r, 180000));
  await cleanupTestReminderMatch();
  console.log('🧹 Match test supprimé (ajoute --keep pour le garder plus longtemps)');
} else {
  console.log(`\n📌 Match test conservé (#${seeded.matchId}) — pronostique ou supprime-le manuellement`);
}

console.log('\n✅ Terminé\n');
process.exit(0);

}

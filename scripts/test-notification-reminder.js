/**
 * Simule un match dans ~1h sans pronostic et déclenche le rappel push.
 *
 * Usage:
 *   node scripts/generate-vapid-keys.js          # une fois, copier dans .env
 *   npm run test:notifications                   # dry-run (affiche les cibles)
 *   npm run test:notifications -- --send         # envoie les push réels
 *   npm run test:notifications -- --send --user 1 --minutes 60
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

const args = process.argv.slice(2);
const send = args.includes('--send');
const keep = args.includes('--keep');
const userId = Number(args.find((_, i, a) => a[i - 1] === '--user') ?? 1);
const minutes = Number(args.find((_, i, a) => a[i - 1] === '--minutes') ?? 60);
const groupId = Number(args.find((_, i, a) => a[i - 1] === '--group') ?? 1);

await migrate();

console.log('\n📋 Test rappel pronostic Matchday\n');

const user = await get('SELECT id, username, display_name FROM users WHERE id = ?', [userId]);
if (!user) {
  console.error(`❌ Utilisateur id=${userId} introuvable`);
  process.exit(1);
}

const subs = await all('SELECT id, endpoint FROM push_subscriptions WHERE user_id = ?', [userId]);
console.log(`👤 ${user.display_name} (@${user.username})`);
console.log(`📱 Abonnements push enregistrés : ${subs.length}`);

const vapid = configureWebPush();
if (!vapid.ok) {
  console.warn(`⚠️  ${vapid.error}`);
  console.warn('   Lance : node scripts/generate-vapid-keys.js\n');
}

const seeded = await seedTestReminderMatch({ userId, groupId, minutes });
console.log(`⚽ Match test créé (#${seeded.matchId})`);
console.log(`   ${seeded.home} vs ${seeded.away}`);
console.log(`   Coup d'envoi : ${seeded.kickoff} (dans ~${minutes} min)`);
console.log(`   Groupe #${groupId} — aucun pronostic pour cet utilisateur\n`);

const targets = await findPendingReminderTargets({ userId, minutes, windowMinutes: 10 });
console.log(`🎯 Cibles rappel (fenêtre ${minutes}±10 min) : ${targets.length}`);
targets.forEach(t => {
  console.log(`   • ${t.home_team_name} vs ${t.away_team_name} → user ${t.user_id} (${t.group_name})`);
});

if (!send) {
  console.log('\n💡 Mode simulation (--dry-run). Pour envoyer les push :');
  console.log('   npm run test:notifications -- --send\n');
  console.log('📌 Côté navigateur :');
  console.log('   1. Ouvre http://localhost:3000 et connecte-toi');
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

const result = await sendPredictionReminders({ userId, minutes, windowMinutes: 10 });
console.log(`\n📤 Notifications traitées : ${result.count}`);
for (const r of result.results) {
  const push = r.push ?? {};
  console.log(`   ✓ ${r.home_team_name} vs ${r.away_team_name}`);
  console.log(`     Push envoyés: ${push.sent ?? 0}, échecs: ${push.failed ?? 0}`);
  if (push.skipped) console.log(`     (${push.reason})`);
}

if (!keep) {
  await cleanupTestReminderMatch();
  console.log('\n🧹 Match test supprimé (ajoute --keep pour le garder)');
}

console.log('\n✅ Terminé\n');
process.exit(0);

}

/**
 * Copie les pronostics (et paris vainqueur) d'un utilisateur entre deux groupes.
 *
 * Usage:
 *   npm run copy:predictions -- --user Breizhantifa --from "GroupeTest" --to "La Cousinade"
 *   npm run copy:predictions -- --user marty --from GroupeTest --to "La Cousinade" --dry-run
 */
import 'dotenv/config';
import { migrate, get, run, all } from '../server/db/connection.js';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function printHelp() {
  console.log(`
Copie les pronostics d'un utilisateur d'un groupe vers un autre.

Options:
  --user <name>       Pseudo ou nom affiché (ex. Breizhantifa)
  --from <group>      Groupe source (ex. GroupeTest)
  --to <group>        Groupe destination (ex. La Cousinade)
  --dry-run           Affiche ce qui serait copié sans écrire
  --help              Affiche cette aide

Exemple:
  npm run copy:predictions -- --user Breizhantifa --from GroupeTest --to "La Cousinade"
`);
}

async function resolveUser(name) {
  return get(
    `SELECT id, username, display_name FROM users
     WHERE lower(username) = lower(?) OR lower(display_name) = lower(?)`,
    [name, name]
  );
}

async function resolveGroup(name) {
  return get('SELECT id, name FROM groups WHERE name = ?', [name]);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const userName = argValue('--user');
const fromGroup = argValue('--from');
const toGroup = argValue('--to');
const dryRun = args.includes('--dry-run');

if (!userName || !fromGroup || !toGroup) {
  printHelp();
  process.exit(1);
}

await migrate();

const user = await resolveUser(userName);
if (!user) {
  console.error(`Utilisateur introuvable : ${userName}`);
  process.exit(1);
}

const src = await resolveGroup(fromGroup);
const dst = await resolveGroup(toGroup);
if (!src) {
  console.error(`Groupe source introuvable : ${fromGroup}`);
  process.exit(1);
}
if (!dst) {
  console.error(`Groupe destination introuvable : ${toGroup}`);
  process.exit(1);
}

const member = await get(
  'SELECT 1 AS ok FROM group_members WHERE group_id = ? AND user_id = ?',
  [dst.id, user.id]
);
if (!member) {
  console.error(`${user.display_name} n'est pas membre de « ${dst.name} »`);
  process.exit(1);
}

const toCopy = await all(
  `SELECT p.match_id, p.home_score, p.away_score, p.points, p.points_detail,
          m.home_team_name, m.away_team_name, m.matchday, c.code AS comp_code
   FROM predictions p
   JOIN matches m ON m.id = p.match_id
   JOIN competitions c ON c.id = m.competition_id
   JOIN group_competitions gc ON gc.competition_id = m.competition_id AND gc.group_id = ?
   WHERE p.user_id = ? AND p.group_id = ?
   ORDER BY m.kickoff_at`,
  [dst.id, user.id, src.id]
);

const betsToCopy = await all(
  `SELECT sb.competition_id, sb.season, sb.bet_type, sb.bet_value, sb.points, c.code AS comp_code
   FROM special_bets sb
   JOIN competitions c ON c.id = sb.competition_id
   JOIN group_competitions gc ON gc.competition_id = sb.competition_id AND gc.group_id = ?
   WHERE sb.user_id = ? AND sb.group_id = ?`,
  [dst.id, user.id, src.id]
);

console.log(`Utilisateur : ${user.display_name} (@${user.username})`);
console.log(`Copie : ${src.name} → ${dst.name}`);
console.log(`Pronostics à copier : ${toCopy.length}`);
console.log(`Paris spéciaux à copier : ${betsToCopy.length}`);

if (dryRun) {
  for (const p of toCopy.slice(0, 10)) {
    console.log(`  · ${p.comp_code} J${p.matchday} ${p.home_team_name} ${p.home_score}-${p.away_score} ${p.away_team_name} (${p.points ?? '?'} pts)`);
  }
  if (toCopy.length > 10) console.log(`  … et ${toCopy.length - 10} autres`);
  for (const b of betsToCopy) {
    console.log(`  · ${b.comp_code} ${b.bet_type} : ${b.bet_value}`);
  }
  process.exit(0);
}

const preds = await run(
  `INSERT INTO predictions (user_id, group_id, match_id, home_score, away_score, points, points_detail, updated_at)
   SELECT p.user_id, ?, p.match_id, p.home_score, p.away_score, p.points, p.points_detail, datetime('now')
   FROM predictions p
   JOIN matches m ON m.id = p.match_id
   JOIN group_competitions gc ON gc.competition_id = m.competition_id AND gc.group_id = ?
   WHERE p.user_id = ? AND p.group_id = ?
   ON CONFLICT(user_id, group_id, match_id) DO UPDATE SET
     home_score = excluded.home_score,
     away_score = excluded.away_score,
     points = excluded.points,
     points_detail = excluded.points_detail,
     updated_at = datetime('now')`,
  [dst.id, dst.id, user.id, src.id]
);

const bets = await run(
  `INSERT INTO special_bets (user_id, group_id, competition_id, season, bet_type, bet_value, points, created_at)
   SELECT sb.user_id, ?, sb.competition_id, sb.season, sb.bet_type, sb.bet_value, sb.points, datetime('now')
   FROM special_bets sb
   JOIN group_competitions gc ON gc.competition_id = sb.competition_id AND gc.group_id = ?
   WHERE sb.user_id = ? AND sb.group_id = ?
   ON CONFLICT(user_id, group_id, competition_id, season, bet_type) DO UPDATE SET
     bet_value = excluded.bet_value,
     points = excluded.points`,
  [dst.id, dst.id, user.id, src.id]
);

const total = await get(
  'SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS pts FROM predictions WHERE user_id = ? AND group_id = ?',
  [user.id, dst.id]
);

console.log('OK');
console.log(`Pronostics écrits : ${preds.rowsAffected ?? 0}`);
console.log(`Paris spéciaux écrits : ${bets.rowsAffected ?? 0}`);
console.log(`Total dans « ${dst.name} » : ${total.n} pronos, ${total.pts} pts`);

/**
 * Insère les pronos WhatsApp du week-end (Shenkare / Stargui / Breizhantifa).
 *
 * Usage:
 *   node scripts/insert-weekend-pronos.js              # preview
 *   node scripts/insert-weekend-pronos.js --apply      # écriture + recalcul
 *   node scripts/insert-weekend-pronos.js --group "La Cousinade"
 */
import 'dotenv/config';
import { all, run } from '../server/db/connection.js';
import { normalizeTeamName } from '../server/services/bsd.js';
import { autoRecalculateFinishedMatches } from '../server/services/sync.js';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes('--apply');
const GROUP_NAME = argValue('--group');
const FROM = argValue('--from') ?? '2026-09-11';
const TO = argValue('--to') ?? '2026-09-14';

/** [username, teamA, scoreA, teamB, scoreB] */
const PRONOS = [
  ['shenkare', 'augsburg', 2, 'leverkusen', 3],
  ['shenkare', 'dortmund', 4, 'paderborn', 0],
  ['shenkare', 'freiburg', 3, 'gladbach', 1],
  ['shenkare', 'hoffenheim', 0, 'stuttgart', 3],
  ['shenkare', 'mainz', 2, 'frankfurt', 4],
  ['shenkare', 'koln', 2, 'werder', 1],
  ['shenkare', 'aston', 1, 'nottingham', 1],
  ['shenkare', 'bournemouth', 3, 'brentford', 2],
  ['shenkare', 'chelsea', 2, 'hull', 0],
  ['shenkare', 'palace', 0, 'ipswich', 0],
  ['shenkare', 'liverpool', 3, 'fulham', 1],
  ['shenkare', 'tottenham', 0, 'everton', 1],
  ['shenkare', 'sunderland', 0, 'arsenal', 2],
  ['shenkare', 'santander', 0, 'alaves', 2],
  ['shenkare', 'osasuna', 1, 'espanyol', 0],
  ['shenkare', 'athletic', 3, 'elche', 0],
  ['shenkare', 'real madrid', 4, 'vallecano', 0],
  ['shenkare', 'genoa', 0, 'frosinone', 1],
  ['shenkare', 'lazio', 0, 'milan', 1],
  ['shenkare', 'atalanta', 2, 'cagliari', 1],
  ['shenkare', 'leipzig', 3, 'hamburg', 0],
  ['shenkare', 'elversberg', 0, 'bayern', 5],
  ['shenkare', 'coventry', 1, 'brighton', 3],
  ['shenkare', 'manchester c', 1, 'manchester u', 2],
  ['shenkare', 'celta', 0, 'malaga', 1],
  ['shenkare', 'levante', 1, 'barcelona', 4],
  ['shenkare', 'getafe', 0, 'coruna', 1],
  ['shenkare', 'sociedad', 1, 'atletico', 1],
  ['shenkare', 'lille', 2, 'troyes', 0],
  ['shenkare', 'le mans', 0, 'lens', 2],
  ['shenkare', 'brest', 0, 'germain', 2],
  ['shenkare', 'lecce', 1, 'monza', 0],
  ['shenkare', 'napoli', 3, 'bologna', 1],
  ['shenkare', 'sassuolo', 0, 'juventus', 2],

  ['stargui', 'union', 1, 'schalke', 0],
  ['stargui', 'sevilla', 2, 'valencia', 1],
  ['stargui', 'rennes', 2, 'marseille', 1],
  ['stargui', 'venezia', 1, 'fiorentina', 2],
  ['stargui', 'augsburg', 1, 'leverkusen', 2],
  ['stargui', 'dortmund', 2, 'paderborn', 0],
  ['stargui', 'freiburg', 1, 'gladbach', 1],
  ['stargui', 'hoffenheim', 1, 'stuttgart', 2],
  ['stargui', 'mainz', 1, 'frankfurt', 2],
  ['stargui', 'koln', 1, 'werder', 0],
  ['stargui', 'aston', 2, 'nottingham', 1],
  ['stargui', 'bournemouth', 2, 'brentford', 1],
  ['stargui', 'chelsea', 2, 'hull', 0],
  ['stargui', 'palace', 2, 'ipswich', 1],
  ['stargui', 'liverpool', 2, 'fulham', 1],
  ['stargui', 'tottenham', 1, 'everton', 2],
  ['stargui', 'sunderland', 1, 'arsenal', 2],
  ['stargui', 'santander', 0, 'alaves', 1],
  ['stargui', 'osasuna', 1, 'espanyol', 1],
  ['stargui', 'athletic', 2, 'elche', 0],
  ['stargui', 'real madrid', 2, 'vallecano', 1],
  ['stargui', 'strasbourg', 2, 'monaco', 3],
  ['stargui', 'auxerre', 2, 'nice', 1],
  ['stargui', 'havre', 1, 'angers', 1],
  ['stargui', 'lorient', 2, 'toulouse', 1],
  ['stargui', 'paris fc', 1, 'lyon', 2],
  ['stargui', 'genoa', 2, 'frosinone', 1],
  ['stargui', 'lazio', 1, 'milan', 2],
  ['stargui', 'atalanta', 2, 'cagliari', 1],
  ['stargui', 'leipzig', 3, 'hamburg', 1],
  ['stargui', 'elversberg', 0, 'bayern', 4],
  ['stargui', 'coventry', 1, 'brighton', 2],
  ['stargui', 'manchester u', 2, 'manchester c', 1],
  ['stargui', 'celta', 2, 'malaga', 1],
  ['stargui', 'levante', 1, 'barcelona', 3],
  ['stargui', 'getafe', 1, 'coruna', 0],
  ['stargui', 'sociedad', 1, 'atletico', 2],
  ['stargui', 'lille', 2, 'troyes', 1],
  ['stargui', 'le mans', 1, 'lens', 2],
  ['stargui', 'brest', 1, 'germain', 3],
  ['stargui', 'lecce', 1, 'monza', 0],
  ['stargui', 'napoli', 2, 'bologna', 1],
  ['stargui', 'sassuolo', 1, 'juventus', 1],

  ['breizhantifa', 'strasbourg', 1, 'monaco', 2],
  ['breizhantifa', 'auxerre', 0, 'nice', 1],
  ['breizhantifa', 'havre', 1, 'angers', 1],
  ['breizhantifa', 'lorient', 2, 'toulouse', 1],
  ['breizhantifa', 'paris fc', 1, 'lyon', 3],
  ['breizhantifa', 'aston', 0, 'nottingham', 0],
  ['breizhantifa', 'bournemouth', 1, 'brentford', 2],
  ['breizhantifa', 'chelsea', 2, 'hull', 2],
  ['breizhantifa', 'palace', 1, 'ipswich', 0],
  ['breizhantifa', 'liverpool', 2, 'fulham', 0],
  ['breizhantifa', 'tottenham', 0, 'everton', 2],
  ['breizhantifa', 'sunderland', 0, 'arsenal', 2],
  ['breizhantifa', 'santander', 1, 'alaves', 2],
  ['breizhantifa', 'osasuna', 1, 'espanyol', 1],
  ['breizhantifa', 'athletic', 1, 'elche', 1],
  ['breizhantifa', 'real madrid', 2, 'vallecano', 1],
  ['breizhantifa', 'genoa', 0, 'frosinone', 0],
  ['breizhantifa', 'lazio', 0, 'milan', 1],
  ['breizhantifa', 'atalanta', 2, 'cagliari', 1],
  ['breizhantifa', 'augsburg', 2, 'leverkusen', 2],
  ['breizhantifa', 'dortmund', 2, 'paderborn', 0],
  ['breizhantifa', 'freiburg', 4, 'gladbach', 2],
  ['breizhantifa', 'mainz', 1, 'frankfurt', 0],
  ['breizhantifa', 'koln', 2, 'werder', 2],
  ['breizhantifa', 'lille', 2, 'troyes', 0],
  ['breizhantifa', 'le mans', 1, 'lens', 1],
  ['breizhantifa', 'brest', 1, 'germain', 2],
  ['breizhantifa', 'coventry', 0, 'brighton', 1],
  ['breizhantifa', 'manchester u', 1, 'manchester c', 2],
  ['breizhantifa', 'celta', 1, 'malaga', 1],
  ['breizhantifa', 'levante', 1, 'barcelona', 3],
  ['breizhantifa', 'getafe', 0, 'coruna', 0],
  ['breizhantifa', 'sociedad', 1, 'atletico', 1],
  ['breizhantifa', 'lecce', 1, 'monza', 0],
  ['breizhantifa', 'napoli', 2, 'bologna', 0],
  ['breizhantifa', 'sassuolo', 0, 'juventus', 2],
  ['breizhantifa', 'leipzig', 2, 'hamburg', 0],
  ['breizhantifa', 'elversberg', 0, 'bayern', 5],
];

function matchesKey(name, key) {
  const n = normalizeTeamName(name);
  const k = normalizeTeamName(key);
  if (k === 'koln') return n.includes('koln') || n.includes('cologne');
  if (k === 'germain') return n.includes('germain') || n.includes('psg') || n.includes('paris sg');
  if (k === 'coruna') return n.includes('coruna') || n.includes('corogne');
  if (k === 'paris fc') {
    return n.includes('paris fc')
      || (n.includes('paris') && !n.includes('germain') && !n.includes('psg') && !n.includes('saint'));
  }
  if (k === 'milan') return n.includes('milan') && !n.includes('inter');
  if (k === 'rennes') return n.includes('rennes') || n.includes('rennais');
  return n.includes(k);
}

const users = await all(`
  SELECT id, username, display_name FROM users
  WHERE lower(username) IN ('shenkare', 'stargui', 'breizhantifa')
`);
const userByName = Object.fromEntries(users.map(u => [u.username.toLowerCase(), u]));

if (!users.length) {
  console.error('Aucun user shenkare / stargui / breizhantifa trouvé.');
  process.exit(1);
}

const groupParams = users.map(u => u.id);
let groupSql = `
  SELECT gm.user_id, g.id AS group_id, g.name AS group_name
  FROM group_members gm
  JOIN groups g ON g.id = gm.group_id
  WHERE gm.user_id IN (${users.map(() => '?').join(',')})
`;
if (GROUP_NAME) {
  groupSql += ' AND g.name = ?';
  groupParams.push(GROUP_NAME);
}
const groups = await all(groupSql, groupParams);

const matches = await all(`
  SELECT m.id, m.home_team_name, m.away_team_name, m.kickoff_at, m.status, c.code
  FROM matches m
  JOIN competitions c ON c.id = m.competition_id
  WHERE m.kickoff_at >= ? AND m.kickoff_at < ?
  ORDER BY m.kickoff_at
`, [FROM, TO]);

const ok = [];
const missing = [];
const ambiguous = [];

for (const [username, a, sa, b, sb] of PRONOS) {
  const user = userByName[username];
  const label = `${username}: ${a} ${sa}-${sb} ${b}`;
  if (!user) {
    missing.push(`${label} (user introuvable)`);
    continue;
  }

  const found = matches.filter(m =>
    (matchesKey(m.home_team_name, a) && matchesKey(m.away_team_name, b))
    || (matchesKey(m.home_team_name, b) && matchesKey(m.away_team_name, a))
  );

  if (found.length === 0) {
    missing.push(label);
    continue;
  }
  if (found.length > 1) {
    ambiguous.push(`${label} → ${found.map(m => `${m.id} ${m.home_team_name}-${m.away_team_name}`).join(' | ')}`);
    continue;
  }

  const match = found[0];
  const homeIsA = matchesKey(match.home_team_name, a) && matchesKey(match.away_team_name, b);
  const homeScore = homeIsA ? sa : sb;
  const awayScore = homeIsA ? sb : sa;
  const userGroups = groups.filter(g => g.user_id === user.id);
  if (!userGroups.length) {
    missing.push(`${label} (pas de groupe)`);
    continue;
  }

  for (const g of userGroups) {
    ok.push({
      username,
      group: g.group_name,
      groupId: g.group_id,
      userId: user.id,
      matchId: match.id,
      fixture: `${match.code} ${match.home_team_name} ${homeScore}-${awayScore} ${match.away_team_name}`,
      homeScore,
      awayScore,
    });
  }
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'PREVIEW'}  |  matchs ${FROM} → ${TO}: ${matches.length}`);
console.log(`Users: ${users.map(u => `${u.display_name} (@${u.username})`).join(', ')}`);
console.log(`OK: ${ok.length}  |  non trouvés: ${missing.length}  |  ambigus: ${ambiguous.length}\n`);

for (const row of ok) {
  console.log(`  ${row.username.padEnd(13)} [${row.group}]  ${row.fixture}  (match ${row.matchId})`);
}

if (missing.length) {
  console.log('\n--- NON TROUVÉS (souvent coupes absentes de Matchday) ---');
  for (const line of missing) console.log('  ' + line);
}

if (ambiguous.length) {
  console.log('\n--- AMBIGUS (à traiter à la main) ---');
  for (const line of ambiguous) console.log('  ' + line);
}

if (!APPLY) {
  console.log('\nRien écrit. Relance avec --apply pour insérer.');
  process.exit(0);
}

let written = 0;
for (const row of ok) {
  await run(
    `INSERT INTO predictions (user_id, group_id, match_id, home_score, away_score, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, group_id, match_id) DO UPDATE SET
       home_score = excluded.home_score,
       away_score = excluded.away_score,
       points = NULL,
       points_detail = NULL,
       updated_at = datetime('now')`,
    [row.userId, row.groupId, row.matchId, row.homeScore, row.awayScore]
  );
  written += 1;
}

const recalculated = await autoRecalculateFinishedMatches();
console.log(`\nÉcrits: ${written}  |  points recalculés: ${recalculated}`);

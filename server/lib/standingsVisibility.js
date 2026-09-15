/** Observateurs : membres du groupe, absents du classement et de l’onglet vainqueurs. */
export const STANDINGS_OBSERVERS = [
  { groupName: 'La cousinade', username: 'marty' },
];

function norm(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isStandingsObserver(username, groupName) {
  const user = norm(username);
  const group = norm(groupName);
  return STANDINGS_OBSERVERS.some(
    (row) => norm(row.username) === user && norm(row.groupName) === group
  );
}

/**
 * Filtre SQL : suppose les alias `u` (users) et `gm` (group_members).
 */
export const RANKED_MEMBERS_SQL = STANDINGS_OBSERVERS
  .map((row) => {
    const user = norm(row.username).replace(/'/g, "''");
    const group = norm(row.groupName).replace(/'/g, "''");
    return `(LOWER(TRIM(u.username)) = '${user}' AND gm.group_id IN (SELECT id FROM groups WHERE LOWER(TRIM(name)) = '${group}'))`;
  })
  .join(' OR ');

export const RANKED_MEMBERS_WHERE = RANKED_MEMBERS_SQL
  ? `NOT (${RANKED_MEMBERS_SQL})`
  : '1=1';

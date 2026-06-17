/**
 * Calcule les badges automatiques selon les stats du joueur.
 */
export function computeBadges(stats) {
  const badges = [];
  const { exactCount, diffCount, winnerCount, missCount, rank, memberCount, precision, xiPoints } = stats;

  if (exactCount >= 3) badges.push({ id: 'exact_king', label: 'Roi des exacts', emoji: '👑' });
  if (exactCount >= 1 && precision >= 40) badges.push({ id: 'sniper', label: 'Sniper', emoji: '🎯' });
  if (winnerCount >= 5 && missCount <= winnerCount) badges.push({ id: 'good_nose', label: 'Bon nez', emoji: '🍀' });
  if (missCount >= 8) badges.push({ id: 'serial_miss', label: 'Serial raté', emoji: '💀' });
  if (rank === 1 && memberCount > 1) badges.push({ id: 'leader', label: 'En tête', emoji: '🥇' });
  if (diffCount >= 3) badges.push({ id: 'gap_master', label: 'Maître de l\'écart', emoji: '📐' });
  if (xiPoints >= 5) badges.push({ id: 'xi_star', label: 'Star du 11', emoji: '⭐' });
  if (exactCount === 0 && stats.scoredCount >= 5) badges.push({ id: 'dry_spell', label: 'Sèche', emoji: '🌵' });

  return badges.slice(0, 6);
}

export function formatRankingExport(groupName, rows) {
  const medals = ['🥇', '🥈', '🥉'];
  let text = `⚽ Matchday — Classement\n📋 Groupe : ${groupName}\n\n`;
  rows.forEach((r, i) => {
    const medal = i < 3 ? medals[i] : `${i + 1}.`;
    const xi = r.xiPoints ? ` (+${r.xiPoints} pts 11)` : '';
    text += `${medal} ${r.displayName} — ${r.totalPoints} pts${xi}\n`;
  });
  text += `\nPartagé depuis Matchday`;
  return text;
}

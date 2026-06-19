import { Router } from 'express';
import { all, get, run } from '../db/connection.js';
import { authRequired, groupMemberRequired, groupAdminRequired } from '../middleware/auth.js';
import { getGroupTeamsList } from '../services/groupTeams.js';
import crypto from 'crypto';

const router = Router();

function generateInviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

router.get('/competitions', authRequired, async (_req, res) => {
  const comps = await all('SELECT * FROM competitions ORDER BY id');
  res.json(comps.map(c => ({
    id: c.id, code: c.code, nom: c.nom, pays: c.pays, emoji: c.emoji, logo: c.logo,
    couleur: c.couleur, couleurBg: c.couleur_bg, saisonActive: c.saison_active,
  })));
});

router.post('/', authRequired, async (req, res) => {
  try {
    const { name, competitionIds, isPublic } = req.body;
    if (!name || !competitionIds?.length) {
      return res.status(400).json({ error: 'Nom et au moins 1 championnat requis' });
    }

    const inviteCode = generateInviteCode();
    const result = await run(
      'INSERT INTO groups (name, invite_code, admin_id, is_public) VALUES (?, ?, ?, ?)',
      [name, inviteCode, req.user.id, isPublic ? 1 : 0]
    );
    const groupId = Number(result.lastInsertRowid);

    for (const cid of competitionIds) {
      await run('INSERT INTO group_competitions (group_id, competition_id) VALUES (?, ?)', [groupId, cid]);
    }
    await run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)', [groupId, req.user.id]);

    res.status(201).json({ id: groupId, name, inviteCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/mine', authRequired, async (req, res) => {
  const rows = await all(
    `SELECT g.id, g.name, g.invite_code, g.is_public,
            (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = ?
     ORDER BY g.name`,
    [req.user.id]
  );
  res.json(rows.map(g => ({
    id: g.id,
    name: g.name,
    inviteCode: g.invite_code,
    isPublic: !!g.is_public,
    memberCount: Number(g.member_count ?? 0),
  })));
});

router.get('/public/list', async (_req, res) => {
  const rows = await all(
    `SELECT g.id, g.name, COUNT(gm.user_id) AS member_count
     FROM groups g
     LEFT JOIN group_members gm ON gm.group_id = g.id
     WHERE g.is_public = 1
     GROUP BY g.id
     ORDER BY g.name`
  );
  res.json(rows.map(g => ({
    id: g.id,
    name: g.name,
    memberCount: Number(g.member_count ?? 0),
  })));
});

router.get('/public', authRequired, async (_req, res) => {
  const groups = await all('SELECT id, name, invite_code FROM groups WHERE is_public = 1 ORDER BY name');
  res.json(groups);
});

router.post('/join', authRequired, async (req, res) => {
  const { inviteCode, groupId } = req.body;
  let group;

  if (groupId) {
    group = await get('SELECT * FROM groups WHERE id = ? AND is_public = 1', [Number(groupId)]);
    if (!group) return res.status(404).json({ error: 'Groupe introuvable' });
  } else if (inviteCode?.trim()) {
    group = await get('SELECT * FROM groups WHERE invite_code = ?', [inviteCode.trim().toUpperCase()]);
    if (!group) return res.status(404).json({ error: 'Code invalide' });
  } else {
    return res.status(400).json({ error: 'Choisis un groupe ou entre un code' });
  }

  const existing = await get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [group.id, req.user.id]);
  if (!existing) {
    await run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)', [group.id, req.user.id]);
  }
  res.json({ id: group.id, name: group.name });
});

router.get('/:groupId', authRequired, groupMemberRequired, async (req, res) => {
  const group = await get('SELECT * FROM groups WHERE id = ?', [req.groupId]);
  const competitions = await all(
    `SELECT c.* FROM competitions c
     JOIN group_competitions gc ON gc.competition_id = c.id
     WHERE gc.group_id = ?`,
    [req.groupId]
  );
  const members = await all(
    `SELECT u.id, u.display_name, u.avatar, u.profile_color FROM users u
     JOIN group_members gm ON gm.user_id = u.id WHERE gm.group_id = ?`,
    [req.groupId]
  );
  res.json({ ...group, competitions, members });
});

router.patch('/:groupId/competitions', authRequired, groupAdminRequired, async (req, res) => {
  const { competitionIds } = req.body;
  if (!competitionIds?.length) return res.status(400).json({ error: 'Au moins 1 championnat requis' });

  await run('DELETE FROM group_competitions WHERE group_id = ?', [req.groupId]);
  for (const cid of competitionIds) {
    await run('INSERT INTO group_competitions (group_id, competition_id) VALUES (?, ?)', [req.groupId, cid]);
  }
  res.json({ ok: true });
});

router.patch('/:groupId/settings', authRequired, groupAdminRequired, async (req, res) => {
  const { seasonXiDeadline, specialBetsDeadline, scoringExact, scoringDiff, scoringWinner } = req.body;
  const updates = [];
  const params = [];
  if (seasonXiDeadline !== undefined) { updates.push('season_xi_deadline = ?'); params.push(seasonXiDeadline); }
  if (specialBetsDeadline !== undefined) { updates.push('special_bets_deadline = ?'); params.push(specialBetsDeadline); }
  if (scoringExact !== undefined) { updates.push('scoring_exact = ?'); params.push(scoringExact); }
  if (scoringDiff !== undefined) { updates.push('scoring_diff = ?'); params.push(scoringDiff); }
  if (scoringWinner !== undefined) { updates.push('scoring_winner = ?'); params.push(scoringWinner); }
  if (updates.length === 0) return res.status(400).json({ error: 'Rien à mettre à jour' });

  params.push(req.groupId);
  await run(`UPDATE groups SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
});

/** Clubs des championnats du groupe (avatars écusson) */
router.get('/:groupId/clubs', authRequired, groupMemberRequired, async (req, res) => {
  try {
    const teams = await getGroupTeamsList(req.groupId);
    res.json(teams);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;

import { Router } from 'express';
import { all, get, run } from '../db/connection.js';
import { authRequired, groupMemberRequired } from '../middleware/auth.js';

const router = Router();

export const CHAT_REACTIONS = ['👍', '🔥', '😂', '🎯', '💪', '😱', '❤️', '🏆'];
const MAX_CONTENT = 500;

function inPlaceholders(ids) {
  return ids.map(() => '?').join(',');
}

router.get('/:groupId/chat', authRequired, groupMemberRequired, async (req, res) => {
  const messages = await all(
    `SELECT cm.*, u.display_name, u.avatar, u.profile_color FROM chat_messages cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.group_id = ? ORDER BY cm.created_at DESC LIMIT 100`,
    [req.groupId]
  );

  if (!messages.length) return res.json([]);

  const ids = messages.map(m => m.id);
  const ph = inPlaceholders(ids);

  const [reactionRows, myRows] = await Promise.all([
    all(
      `SELECT message_id, emoji, COUNT(*) as count
       FROM chat_reactions
       WHERE message_id IN (${ph})
       GROUP BY message_id, emoji`,
      ids
    ),
    all(
      `SELECT message_id, emoji FROM chat_reactions
       WHERE user_id = ? AND message_id IN (${ph})`,
      [req.user.id, ...ids]
    ),
  ]);

  const byMessage = Object.fromEntries(ids.map(id => [id, { reactions: [], myReactions: [] }]));
  for (const r of reactionRows) {
    byMessage[r.message_id]?.reactions.push({ emoji: r.emoji, count: Number(r.count) || 0 });
  }
  for (const r of myRows) {
    byMessage[r.message_id]?.myReactions.push(r.emoji);
  }

  res.json(messages.reverse().map(m => ({
    ...m,
    reactions: byMessage[m.id].reactions,
    myReactions: byMessage[m.id].myReactions,
  })));
});

router.post('/:groupId/chat', authRequired, groupMemberRequired, async (req, res) => {
  const content = String(req.body.content ?? '').trim();
  if (!content) return res.status(400).json({ error: 'Message vide' });
  if (content.length > MAX_CONTENT) {
    return res.status(400).json({ error: `Message trop long (${MAX_CONTENT} caractères max)` });
  }

  const result = await run(
    'INSERT INTO chat_messages (group_id, user_id, content) VALUES (?, ?, ?)',
    [req.groupId, req.user.id, content]
  );
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.post('/:groupId/chat/:messageId/reactions', authRequired, groupMemberRequired, async (req, res) => {
  const { emoji } = req.body;
  if (!CHAT_REACTIONS.includes(emoji)) {
    return res.status(400).json({ error: 'Emoji non autorisé' });
  }

  const messageId = Number(req.params.messageId);
  const message = await get(
    'SELECT id FROM chat_messages WHERE id = ? AND group_id = ?',
    [messageId, req.groupId]
  );
  if (!message) return res.status(404).json({ error: 'Message introuvable' });

  const existing = await get(
    'SELECT id FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    [messageId, req.user.id, emoji]
  );

  if (existing) {
    await run('DELETE FROM chat_reactions WHERE id = ?', [existing.id]);
    return res.json({ ok: true, removed: true });
  }

  await run(
    'INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
    [messageId, req.user.id, emoji]
  );
  res.json({ ok: true, added: true });
});

export default router;

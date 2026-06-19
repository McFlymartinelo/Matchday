import { Router } from 'express';
import { all, get, run } from '../db/connection.js';
import { authRequired, groupMemberRequired } from '../middleware/auth.js';

const router = Router();

router.get('/:groupId/chat', authRequired, groupMemberRequired, async (req, res) => {
  const messages = await all(
    `SELECT cm.*, u.display_name, u.avatar, u.profile_color FROM chat_messages cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.group_id = ? ORDER BY cm.created_at DESC LIMIT 100`,
    [req.groupId]
  );

  const withReactions = await Promise.all(messages.map(async (m) => {
    const reactions = await all(
      'SELECT emoji, COUNT(*) as count FROM chat_reactions WHERE message_id = ? GROUP BY emoji',
      [m.id]
    );
    const myReactions = await all(
      'SELECT emoji FROM chat_reactions WHERE message_id = ? AND user_id = ?',
      [m.id, req.user.id]
    );
    return { ...m, reactions, myReactions: myReactions.map(r => r.emoji) };
  }));

  res.json(withReactions.reverse());
});

router.post('/:groupId/chat', authRequired, groupMemberRequired, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Message vide' });

  const result = await run(
    'INSERT INTO chat_messages (group_id, user_id, content) VALUES (?, ?, ?)',
    [req.groupId, req.user.id, content.trim()]
  );
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.post('/:groupId/chat/:messageId/reactions', authRequired, groupMemberRequired, async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'Emoji requis' });

  const messageId = Number(req.params.messageId);
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

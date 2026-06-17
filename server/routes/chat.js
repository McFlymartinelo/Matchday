import { Router } from 'express';
import { all, run } from '../db/connection.js';
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
    return { ...m, reactions };
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
  await run(
    `INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)
     ON CONFLICT(message_id, user_id, emoji) DO NOTHING`,
    [req.params.messageId, req.user.id, emoji]
  );
  res.json({ ok: true });
});

export default router;

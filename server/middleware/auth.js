import jwt from 'jsonwebtoken';
import { get } from '../db/connection.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret';

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, isAdmin: !!user.is_admin }, SECRET, { expiresIn: '30d' });
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentification requise' });
  }
  try {
    req.user = jwt.verify(header.slice(7), SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

export async function groupMemberRequired(req, res, next) {
  const groupId = Number(req.params.groupId || req.body.groupId);
  if (!groupId) return res.status(400).json({ error: 'groupId requis' });

  const member = await get(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, req.user.id]
  );
  if (!member) return res.status(403).json({ error: 'Accès refusé à ce groupe' });
  req.groupId = groupId;
  next();
}

export async function groupAdminRequired(req, res, next) {
  const groupId = Number(req.params.groupId || req.body.groupId);
  const group = await get('SELECT admin_id FROM groups WHERE id = ?', [groupId]);
  if (!group || group.admin_id !== req.user.id) {
    return res.status(403).json({ error: 'Admin du groupe requis' });
  }
  req.groupId = groupId;
  next();
}

export async function adminRequired(req, res, next) {
  const user = await get('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
  if (!user?.is_admin) return res.status(403).json({ error: 'Admin requis' });
  next();
}

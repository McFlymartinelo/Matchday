import jwt from 'jsonwebtoken';
import { get } from '../db/connection.js';

const WEAK_SECRETS = new Set(['', 'dev-secret', 'change-me-in-production']);

export function getJwtSecret() {
  return process.env.JWT_SECRET?.trim() || '';
}

export function assertJwtSecret() {
  const secret = getJwtSecret();
  if (process.env.NODE_ENV === 'production' && WEAK_SECRETS.has(secret)) {
    throw new Error('JWT_SECRET doit être défini avec une valeur forte en production');
  }
}

function signingSecret() {
  const secret = getJwtSecret();
  if (process.env.NODE_ENV === 'production' && WEAK_SECRETS.has(secret)) {
    throw new Error('JWT_SECRET doit être défini avec une valeur forte en production');
  }
  return secret || 'dev-secret';
}

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, isAdmin: !!user.is_admin }, signingSecret(), { expiresIn: '30d' });
}

export function signOtpToken(user, otpPurpose) {
  return jwt.sign(
    { id: user.id, purpose: 'otp', otpPurpose },
    signingSecret(),
    { expiresIn: '15m' }
  );
}

export function readOtpToken(token) {
  const payload = jwt.verify(token, signingSecret());
  if (payload.purpose !== 'otp' || !payload.id) {
    throw new Error('Token OTP invalide');
  }
  return payload;
}

export function signEmailVerifiedToken(email) {
  return jwt.sign(
    { purpose: 'email-verified', email: String(email || '').trim().toLowerCase() },
    signingSecret(),
    { expiresIn: '30m' }
  );
}

export function readEmailVerifiedToken(token) {
  const payload = jwt.verify(token, signingSecret());
  if (payload.purpose !== 'email-verified' || !payload.email) {
    throw new Error('Token email invalide');
  }
  return payload;
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentification requise' });
  }
  try {
    req.user = jwt.verify(header.slice(7), signingSecret());
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

import crypto from 'node:crypto';
import { get, run } from '../db/connection.js';
import { getJwtSecret } from '../middleware/auth.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_MS = Number(process.env.AUTH_OTP_RESEND_MS || 30_000);
const MAX_ATTEMPTS = 5;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validateEmail(email) {
  const value = normalizeEmail(email);
  if (!value) return 'Entre une adresse mail';
  if (!EMAIL_RE.test(value) || value.length > 120) return 'Adresse mail invalide';
  return null;
}

export function maskEmail(email) {
  const value = normalizeEmail(email);
  const [local, domain] = value.split('@');
  if (!domain) return '***';
  const keep = local.slice(0, 1);
  return `${keep}***@${domain}`;
}

export function generateOtpCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

function hashOtp(code) {
  const secret = getJwtSecret() || 'dev-secret';
  return crypto.createHash('sha256').update(`${String(code).trim()}:${secret}`).digest('hex');
}

export function shouldEchoOtp() {
  return process.env.NODE_ENV === 'test' || process.env.AUTH_OTP_ECHO === '1';
}

export async function issueOtp(userId, purpose) {
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await run('DELETE FROM email_otps WHERE user_id = ? AND purpose = ?', [userId, purpose]);
  await run(
    'INSERT INTO email_otps (user_id, purpose, code_hash, expires_at, attempts) VALUES (?, ?, ?, ?, 0)',
    [userId, purpose, hashOtp(code), expiresAt]
  );
  return { code, expiresAt };
}

export async function canResendOtp(userId, purpose) {
  const row = await get(
    'SELECT created_at FROM email_otps WHERE user_id = ? AND purpose = ?',
    [userId, purpose]
  );
  if (!row?.created_at) return { ok: true };
  const wait = RESEND_MS - (Date.now() - new Date(row.created_at).getTime());
  if (wait > 0) return { ok: false, waitMs: wait };
  return { ok: true };
}

export async function verifyOtp(userId, purpose, code) {
  const row = await get(
    'SELECT * FROM email_otps WHERE user_id = ? AND purpose = ?',
    [userId, purpose]
  );
  if (!row) return { ok: false, error: 'Aucun code en cours' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'Code expiré — renvoie-en un' };
  }
  if (Number(row.attempts) >= MAX_ATTEMPTS) {
    return { ok: false, error: 'Trop de tentatives — renvoie un nouveau code' };
  }
  await run('UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?', [row.id]);
  if (row.code_hash !== hashOtp(code)) {
    return { ok: false, error: 'Code incorrect' };
  }
  await run('DELETE FROM email_otps WHERE id = ?', [row.id]);
  return { ok: true };
}

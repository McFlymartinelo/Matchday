import crypto from 'node:crypto';
import { get, run } from '../db/connection.js';
import { getJwtSecret } from '../middleware/auth.js';

export const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_MS = Number(process.env.AUTH_OTP_RESEND_MS || 30_000);
const MAX_ATTEMPTS = 5;
const OTP_MAX = 10 ** OTP_LENGTH;

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

export function validateOtpCode(code) {
  if (!/^\d{6}$/.test(String(code || '').trim())) return 'Code à 6 chiffres invalide';
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
  return String(crypto.randomInt(0, OTP_MAX)).padStart(OTP_LENGTH, '0');
}

function hashOtp(code) {
  const secret = getJwtSecret() || 'dev-secret';
  return crypto.createHash('sha256').update(`${String(code).trim()}:${secret}`).digest('hex');
}

function hashesMatch(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function resendWait(createdAt) {
  if (!createdAt) return { ok: true };
  const wait = RESEND_MS - (Date.now() - new Date(createdAt).getTime());
  if (wait > 0) return { ok: false, waitMs: wait };
  return { ok: true };
}

export function shouldEchoOtp() {
  return process.env.NODE_ENV === 'test' || process.env.AUTH_OTP_ECHO === '1';
}

export async function issueOtpForEmail(email, purpose, userId = null) {
  const mail = normalizeEmail(email);
  if (!mail) throw new Error('Aucune adresse mail');
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await run('DELETE FROM email_otps WHERE email = ? AND purpose = ?', [mail, purpose]);
  if (userId) {
    await run('DELETE FROM email_otps WHERE user_id = ? AND purpose = ?', [userId, purpose]);
  }
  await run(
    'INSERT INTO email_otps (user_id, email, purpose, code_hash, expires_at, attempts) VALUES (?, ?, ?, ?, ?, 0)',
    [userId, mail, purpose, hashOtp(code), expiresAt]
  );
  return { code, expiresAt };
}

export async function issueOtp(userId, purpose) {
  const user = await get('SELECT email FROM users WHERE id = ?', [userId]);
  return issueOtpForEmail(user?.email, purpose, userId);
}

export async function canResendOtp(userId, purpose) {
  const row = await get(
    'SELECT created_at FROM email_otps WHERE user_id = ? AND purpose = ?',
    [userId, purpose]
  );
  return resendWait(row?.created_at);
}

export async function canResendOtpByEmail(email, purpose) {
  const row = await get(
    'SELECT created_at FROM email_otps WHERE email = ? AND purpose = ?',
    [normalizeEmail(email), purpose]
  );
  return resendWait(row?.created_at);
}

async function consumeOtpRow(row, code) {
  if (!row) return { ok: false, error: 'Aucun code en cours' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await run('DELETE FROM email_otps WHERE id = ?', [row.id]);
    return { ok: false, error: 'Code expiré — renvoie-en un' };
  }
  if (Number(row.attempts) >= MAX_ATTEMPTS) {
    return { ok: false, error: 'Trop de tentatives — renvoie un nouveau code' };
  }
  await run('UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?', [row.id]);
  if (!hashesMatch(row.code_hash, hashOtp(code))) {
    return { ok: false, error: 'Code incorrect' };
  }
  await run('DELETE FROM email_otps WHERE id = ?', [row.id]);
  return { ok: true, purpose: row.purpose, email: row.email, userId: row.user_id };
}

export async function verifyOtp(userId, purpose, code) {
  const row = await get(
    'SELECT * FROM email_otps WHERE user_id = ? AND purpose = ?',
    [userId, purpose]
  );
  return consumeOtpRow(row, code);
}

export async function verifyOtpByEmail(email, code) {
  const row = await get(
    'SELECT * FROM email_otps WHERE email = ? ORDER BY created_at DESC LIMIT 1',
    [normalizeEmail(email)]
  );
  return consumeOtpRow(row, code);
}

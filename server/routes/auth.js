import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, run } from '../db/connection.js';
import { authRequired, signToken, signOtpToken, readOtpToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  canResendOtp,
  issueOtp,
  maskEmail,
  normalizeEmail,
  shouldEchoOtp,
  validateEmail,
  verifyOtp,
} from '../lib/otp.js';
import { mailerConfigured, sendOtpEmail } from '../lib/mailer.js';

const router = Router();
const authBurst = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

function validatePassword(password) {
  if (!password) return 'Entre un mot de passe';
  if (password.length < 6) return 'Mot de passe trop court — 6 caractères minimum';
  return null;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email || null,
    emailVerified: !!user.email_verified,
    avatar: user.avatar,
    profileColor: user.profile_color,
    isAdmin: !!user.is_admin,
  };
}

function otpPayload(user, otpPurpose, code, channel = 'email') {
  const payload = {
    needsOtp: true,
    otpToken: signOtpToken(user, otpPurpose),
    emailMasked: maskEmail(user.email),
    channel,
  };
  if (shouldEchoOtp()) payload.devOtp = code;
  return payload;
}

async function startOtp(user, purpose) {
  const { code } = await issueOtp(user.id, purpose);
  const channel = 'email';
  if (mailerConfigured()) {
    try {
      await sendOtpEmail(user.email, code, purpose);
    } catch (err) {
      console.error('OTP mail:', err.message);
      throw new Error("Impossible d'envoyer le mail. Réessaie dans un instant.");
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('Envoi du code par mail non configuré');
  } else if (process.env.NODE_ENV !== 'test') {
    console.warn(`[OTP] Pas de mailer — code ${code} pour ${maskEmail(user.email)} (local seulement)`);
  }
  return otpPayload(user, purpose, code, channel);
}

router.post('/register', authBurst, async (req, res) => {
  try {
    const { username, password, displayName, email } = req.body;
    if (!username?.trim()) {
      return res.status(400).json({ error: 'Choisis un pseudo' });
    }
    const emailError = validateEmail(email);
    if (emailError) return res.status(400).json({ error: emailError });
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const login = username.trim().toLowerCase();
    const mail = normalizeEmail(email);

    const existingName = await get('SELECT id FROM users WHERE username = ?', [login]);
    if (existingName) return res.status(409).json({ error: 'Ce pseudo existe déjà' });
    const existingMail = await get('SELECT id FROM users WHERE email = ?', [mail]);
    if (existingMail) return res.status(409).json({ error: 'Cette adresse mail est déjà utilisée' });

    const hash = await bcrypt.hash(password, 10);
    const name = displayName || username;
    const result = await run(
      'INSERT INTO users (username, password_hash, display_name, email, email_verified) VALUES (?, ?, ?, ?, 0)',
      [login, hash, name, mail]
    );

    const user = {
      id: Number(result.lastInsertRowid),
      username: login,
      display_name: name,
      email: mail,
      email_verified: 0,
      is_admin: 0,
    };
    res.status(201).json(await startOtp(user, 'register'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', authBurst, async (req, res) => {
  try {
    const ident = String(req.body.username || req.body.email || '').trim().toLowerCase();
    const { password } = req.body;
    const user = await get(
      'SELECT * FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)',
      [ident, ident]
    );
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    if (user.email) {
      return res.json(await startOtp(user, 'login'));
    }

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify-otp', authBurst, async (req, res) => {
  try {
    const { otpToken, code } = req.body ?? {};
    if (!otpToken) return res.status(400).json({ error: 'Session OTP manquante' });
    let payload;
    try {
      payload = readOtpToken(otpToken);
    } catch {
      return res.status(401).json({ error: 'Code expiré — reconnecte-toi' });
    }

    const result = await verifyOtp(payload.id, payload.otpPurpose, code);
    if (!result.ok) return res.status(400).json({ error: result.error });

    if (payload.otpPurpose === 'register') {
      await run('UPDATE users SET email_verified = 1 WHERE id = ?', [payload.id]);
    }

    const user = await get('SELECT * FROM users WHERE id = ?', [payload.id]);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/resend-otp', authBurst, async (req, res) => {
  try {
    const { otpToken } = req.body ?? {};
    if (!otpToken) return res.status(400).json({ error: 'Session OTP manquante' });
    let payload;
    try {
      payload = readOtpToken(otpToken);
    } catch {
      return res.status(401).json({ error: 'Code expiré — reconnecte-toi' });
    }

    const wait = await canResendOtp(payload.id, payload.otpPurpose);
    if (!wait.ok) {
      return res.status(429).json({
        error: `Attends encore ${Math.ceil(wait.waitMs / 1000)}s`,
        retryAfter: Math.ceil(wait.waitMs / 1000),
      });
    }

    const user = await get('SELECT * FROM users WHERE id = ?', [payload.id]);
    if (!user?.email) return res.status(400).json({ error: 'Aucune adresse mail' });
    res.json(await startOtp(user, payload.otpPurpose));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/change-password', authRequired, authBurst, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const user = await get('SELECT id, password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!user || !(await bcrypt.compare(currentPassword || '', user.password_hash))) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authRequired, async (req, res) => {
  const user = await get(
    'SELECT id, username, display_name, email, email_verified, avatar, profile_color, is_admin FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(publicUser(user));
});

router.patch('/me', authRequired, async (req, res) => {
  const { displayName, avatar, profileColor } = req.body;
  const updates = [];
  const params = [];
  if (displayName) { updates.push('display_name = ?'); params.push(displayName); }
  if (avatar) { updates.push('avatar = ?'); params.push(avatar); }
  if (profileColor) { updates.push('profile_color = ?'); params.push(profileColor); }
  if (updates.length === 0) return res.status(400).json({ error: 'Rien à mettre à jour' });

  params.push(req.user.id);
  await run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
});

export default router;

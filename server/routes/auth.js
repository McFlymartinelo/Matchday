import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, run } from '../db/connection.js';
import { authRequired, signToken } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Pseudo et mot de passe (6+ car.) requis' });
    }

    const existing = await get('SELECT id FROM users WHERE username = ?', [username.toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'Ce pseudo existe déjà' });

    const hash = await bcrypt.hash(password, 10);
    const name = displayName || username;
    const result = await run(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
      [username.toLowerCase(), hash, name]
    );

    const user = { id: Number(result.lastInsertRowid), username: username.toLowerCase(), is_admin: 0 };
    const token = signToken(user);
    res.status(201).json({ token, user: { id: user.id, username: user.username, displayName: name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await get('SELECT * FROM users WHERE username = ?', [username?.toLowerCase()]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id, username: user.username, displayName: user.display_name,
        avatar: user.avatar, profileColor: user.profile_color, isAdmin: !!user.is_admin,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authRequired, async (req, res) => {
  const user = await get('SELECT id, username, display_name, avatar, profile_color, is_admin FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({
    id: user.id, username: user.username, displayName: user.display_name,
    avatar: user.avatar, profileColor: user.profile_color, isAdmin: !!user.is_admin,
  });
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

/**
 * Rate limiter mémoire (une instance Node). Derrière un reverse proxy,
 * activer `trust proxy` pour lire la vraie IP.
 */
export function rateLimit({ windowMs = 15 * 60 * 1000, max = 20 } = {}) {
  const hits = new Map();

  return function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter(t => now - t < windowMs);
    if (recent.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Trop de tentatives, réessaie plus tard' });
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}

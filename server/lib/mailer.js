const FROM = process.env.SMTP_FROM?.trim()
  || process.env.MAIL_FROM?.trim()
  || 'Matchday <noreply@matchday.app>';

export function mailerConfigured() {
  if (process.env.NODE_ENV === 'test') return false;
  return Boolean(process.env.SMTP_URL?.trim() || process.env.SMTP_HOST?.trim());
}

function otpCopy(purpose) {
  if (purpose === 'login') {
    return { subject: 'Ton code de connexion Matchday', lead: 'Voici le code pour te connecter :' };
  }
  return { subject: 'Ton code Matchday', lead: 'Voici le code pour confirmer ton compte :' };
}

function otpHtml(code, lead) {
  const digits = String(code).split('').join(' ');
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#080b12;font-family:Nunito,Segoe UI,sans-serif;color:#f3f4f6">
  <div style="max-width:420px;margin:0 auto;background:#121722;border-radius:16px;padding:28px 24px;text-align:center">
    <div style="font-size:22px;font-weight:800;margin-bottom:8px">🏆 Matchday</div>
    <p style="color:#8b93a7;font-size:14px;margin:0 0 20px">${lead}</p>
    <div style="font-size:32px;letter-spacing:.28em;font-weight:800;color:#2ee6a8">${digits}</div>
    <p style="color:#6b7280;font-size:12px;margin:20px 0 0">Expire dans 10 minutes. Si tu n'es pas à l'origine de cette demande, ignore ce mail.</p>
  </div>
</body></html>`;
}

function isLocalSmtp(host, port) {
  const h = String(host || '').toLowerCase();
  return port === 1025 || h === 'localhost' || h === '127.0.0.1';
}

function smtpTransportOptions() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const local = isLocalSmtp(host, port);
  return {
    host,
    port,
    secure: !local && (process.env.SMTP_SECURE === 'true' || port === 465),
    tls: local ? { rejectUnauthorized: false } : undefined,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined,
  };
}

// Utilisé par le mailer et par scripts/test-mail.js (diagnostic Brevo/Mailpit).
export function describeSmtpConfig() {
  const url = process.env.SMTP_URL?.trim();
  if (url) return { mode: 'url', url: url.replace(/:\/\/[^@]+@/, '://***@') };
  const opts = smtpTransportOptions();
  return {
    mode: 'host',
    host: opts.host || null,
    port: opts.port,
    secure: opts.secure,
    local: isLocalSmtp(opts.host, opts.port),
    user: opts.auth?.user || null,
    hasPassword: Boolean(opts.auth?.pass),
    from: FROM,
  };
}

export async function createSmtpTransporter() {
  const mod = await import('nodemailer');
  const nodemailer = mod.default ?? mod;
  const url = process.env.SMTP_URL?.trim();
  return url
    ? nodemailer.createTransport(url)
    : nodemailer.createTransport(smtpTransportOptions());
}

async function sendViaSmtp(to, subject, html, text) {
  const transporter = await createSmtpTransporter();
  await transporter.sendMail({ from: FROM, to, subject, html, text });
}

export async function sendOtpEmail(email, code, purpose) {
  const { subject, lead } = otpCopy(purpose);
  const html = otpHtml(code, lead);
  const text = `${lead} ${code}`;
  if (!mailerConfigured()) return null;
  await sendViaSmtp(email, subject, html, text);
  return 'email';
}

export async function sendTestEmail(to) {
  if (!mailerConfigured()) throw new Error('SMTP non configuré (SMTP_HOST/SMTP_URL manquant dans .env)');
  const subject = 'Matchday — test SMTP';
  const html = otpHtml('000000', 'Ceci est un email de test (script test-mail.js), pas un vrai code.');
  const text = 'Email de test Matchday — SMTP fonctionnel.';
  await sendViaSmtp(to, subject, html, text);
}

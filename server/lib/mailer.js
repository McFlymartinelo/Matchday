const FROM = process.env.MAIL_FROM?.trim() || 'Matchday <noreply@matchday.app>';

export function mailerConfigured() {
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

async function sendViaSmtp(to, subject, html, text) {
  const mod = await import('nodemailer');
  const nodemailer = mod.default ?? mod;
  const url = process.env.SMTP_URL?.trim();
  const transporter = url
    ? nodemailer.createTransport(url)
    : nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
        : undefined,
    });
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

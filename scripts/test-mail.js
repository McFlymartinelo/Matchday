/**
 * Diagnostique la config SMTP (Brevo / Mailpit) et envoie un email de test.
 * N'avale jamais l'erreur SMTP (contrairement à deliverOtp en dev) : sert à
 * valider les identifiants Brevo avant de compter sur l'envoi d'OTP réel.
 *
 * Usage:
 *   npm run mail:test -- --to toi@gmail.com
 *   npm run mail:test              (affiche juste la config détectée)
 *
 * Sur le serveur Docker :
 *   docker compose exec matchday npm run mail:test -- --to toi@gmail.com
 */
import 'dotenv/config';
import { describeSmtpConfig, createSmtpTransporter, sendTestEmail } from '../server/lib/mailer.js';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function printConfig() {
  const cfg = describeSmtpConfig();
  console.log('\n📧 Config SMTP détectée (.env)\n');
  if (cfg.mode === 'url') {
    console.log(`   SMTP_URL : ${cfg.url}`);
  } else {
    console.log(`   Host     : ${cfg.host || '(vide — SMTP non configuré)'}`);
    console.log(`   Port     : ${cfg.port}`);
    console.log(`   Secure   : ${cfg.secure} ${cfg.local ? '(détecté comme local — Mailpit)' : '(TLS/STARTTLS distant — Brevo attendu)'}`);
    console.log(`   User     : ${cfg.user || '(vide)'}`);
    console.log(`   Password : ${cfg.hasPassword ? '••• (présent)' : '(vide — Brevo exige un login + clé SMTP)'}`);
    console.log(`   From     : ${cfg.from}`);
  }
  console.log('');
  return cfg;
}

function explainError(err) {
  console.error('\n❌ Échec SMTP\n');
  console.error(`   message : ${err.message}`);
  if (err.code) console.error(`   code    : ${err.code}`);
  if (err.responseCode) console.error(`   smtp    : ${err.responseCode} ${err.response || ''}`.trim());
  if (err.command) console.error(`   command : ${err.command}`);

  if (err.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(String(err.message))) {
    console.error('\n💡 Connexion refusée. Si SMTP_HOST=localhost:1025, Mailpit doit tourner en local');
    console.error('   (docker run -p 1025:1025 -p 8025:8025 axllent/mailpit). En prod, ce sont les');
    console.error('   identifiants Brevo (smtp-relay.brevo.com:587) qui doivent être dans .env.');
  } else if (err.responseCode === 535 || /auth/i.test(String(err.message))) {
    console.error('\n💡 535 = mauvais SMTP_USER/SMTP_PASS Brevo. SMTP_USER ressemble à xxxxx@smtp-brevo.com');
    console.error('   et SMTP_PASS est la "clé SMTP" générée dans le dashboard Brevo (pas le mot de passe');
    console.error('   du compte, pas la clé API). Si tu ne l\'as plus, recrée une clé SMTP.');
  } else if (err.code === 'ETIMEDOUT') {
    console.error('\n💡 Timeout réseau — vérifie que le port sortant (587) n\'est pas bloqué par le');
    console.error('   pare-feu du serveur/hébergeur.');
  } else if (/sender|from/i.test(String(err.message)) || err.responseCode === 550) {
    console.error('\n💡 Sender/domaine non validé chez Brevo. SMTP_FROM doit être une adresse');
    console.error('   validée (ex: noreply@martylab.fr) dans Brevo > Senders & IP.');
  }
  console.error('');
}

const to = argValue('--to');
const cfg = printConfig();

if (!cfg.host && cfg.mode !== 'url') {
  console.log('ℹ️  Renseigne SMTP_HOST (et SMTP_USER/SMTP_PASS pour Brevo) dans .env, puis relance.\n');
  process.exit(1);
}

try {
  console.log('🔌 Vérification de la connexion SMTP (transporter.verify)...');
  const transporter = await createSmtpTransporter();
  await transporter.verify();
  console.log('✅ Connexion + auth SMTP OK\n');
} catch (err) {
  explainError(err);
  process.exit(1);
}

if (!to) {
  console.log('ℹ️  Ajoute --to <email> pour envoyer un vrai email de test (ex: --to toi@gmail.com)\n');
  process.exit(0);
}

try {
  console.log(`✉️  Envoi d'un email de test à ${to}...`);
  await sendTestEmail(to);
  console.log(`✅ Email envoyé à ${to} — vérifie la boîte de réception (et les spams)\n`);
} catch (err) {
  explainError(err);
  process.exit(1);
}

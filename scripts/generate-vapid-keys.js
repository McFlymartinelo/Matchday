import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('\n🔑 Clés VAPID — ajoute-les dans ton fichier .env :\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:admin@matchday.app');
console.log('\nPuis redémarre le serveur (npm run dev).\n');

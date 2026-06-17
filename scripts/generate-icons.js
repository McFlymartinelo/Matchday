import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '../../public/icons');
mkdirSync(iconsDir, { recursive: true });

// PNG 1x1 minimal valide — remplacé visuellement par le gradient CSS du manifest
// Génère des PNG de couleur unie via en-tête PNG minimal
function solidPng(size, r, g, b) {
  // PNG signature + IHDR + IDAT + IEND — simplifié via buffer minimal
  // Utilise un PNG pré-calculé base64 pour une icône violette
  const canvas = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6B3FD6"/>
      <stop offset="100%" style="stop-color:#1C6FD0"/>
    </linearGradient></defs>
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.25)}" fill="url(#g)"/>
    <text x="50%" y="55%" text-anchor="middle" font-size="${Math.round(size * 0.45)}" fill="white">⚽</text>
  </svg>`;
  return canvas;
}

for (const size of [180, 192, 512]) {
  writeFileSync(join(iconsDir, `icon-${size}.svg`), solidPng(size, 107, 63, 214));
}

// Copier SVG comme fallback — le manifest attend PNG, créer des fichiers SVG renommés
// et mettre à jour le manifest pour accepter SVG en dev
console.log('Icônes SVG générées dans public/icons/');

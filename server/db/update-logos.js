import { run } from './connection.js';

const LOGOS = {
  L1: 'https://crests.football-data.org/FL1.png',
  PL: 'https://crests.football-data.org/PL.png',
  PD: 'https://crests.football-data.org/PD.png',
  SA: 'https://crests.football-data.org/SA.png',
  BL1: 'https://crests.football-data.org/BL1.png',
};

export async function updateCompetitionLogos() {
  for (const [code, logo] of Object.entries(LOGOS)) {
    await run('UPDATE competitions SET logo = ? WHERE code = ?', [logo, code]);
  }
}

if (process.argv[1]?.includes('update-logos.js')) {
  const { migrate } = await import('./connection.js');
  await migrate();
  await updateCompetitionLogos();
  console.log('Logos championnats mis à jour.');
}

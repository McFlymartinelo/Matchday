import { run } from './connection.js';

const LOGOS = {
  L1: 'https://crests.football-data.org/FL1.svg',
  PL: 'https://crests.football-data.org/PL.svg',
  PD: 'https://crests.football-data.org/PD.svg',
  SA: 'https://crests.football-data.org/SA.svg',
  BL1: 'https://crests.football-data.org/BL1.svg',
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

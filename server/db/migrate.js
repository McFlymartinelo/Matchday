import { migrate } from './connection.js';

await migrate();
console.log('Migration terminée.');

import pg from 'pg';
import { readConfig } from '../config.js';
import { setupDatabase } from './migrate.js';

if (process.argv[2] !== 'migrate') throw new Error('Use npm run db:migrate with the target configuration.');
const pool = new pg.Pool({ connectionString: readConfig().databaseUrl });
try {
  await setupDatabase(pool, 'live');
} finally {
  await pool.end();
}

import pg from 'pg';
import { readConfig } from '../config.js';
import { setupDatabase, resetMock } from './migrate.js';
const config = readConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl });
try {
  if (process.argv[2] === 'migrate') await setupDatabase(pool, config.mode);
  else if (process.argv[2] === 'reset') await resetMock(pool, config.mode);
  else throw new Error('Use migrate or reset');
} finally { await pool.end(); }

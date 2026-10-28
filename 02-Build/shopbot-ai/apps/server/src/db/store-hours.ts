import type {PoolClient} from 'pg';
export async function migrateStoreHours(c:PoolClient){
 if((await c.query('SELECT 1 FROM schema_migrations WHERE version=53')).rowCount)return;
 await c.query(`ALTER TABLE stores ADD COLUMN IF NOT EXISTS opening_hours jsonb;
 ALTER TABLE stores ADD COLUMN IF NOT EXISTS hours_revision integer NOT NULL DEFAULT 0;
 INSERT INTO schema_migrations(version) VALUES(53);`);
}

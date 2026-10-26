import type {PoolClient} from 'pg';

export async function migrateOwnerDemoLogin(c:PoolClient){
 if((await c.query('SELECT 1 FROM schema_migrations WHERE version=51')).rowCount)return;
 await c.query(`
 CREATE TABLE owner_demo_sessions(
  token_hash text PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),hostname text NOT NULL,
  password_version text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL
 );
 CREATE INDEX owner_demo_sessions_expiry ON owner_demo_sessions(expires_at);
 CREATE TABLE owner_demo_login_limits(
  store_id uuid NOT NULL REFERENCES stores(id),bucket text NOT NULL,
  attempts integer NOT NULL,window_started_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,bucket)
 );
 INSERT INTO schema_migrations(version) VALUES(51);
 `);
}

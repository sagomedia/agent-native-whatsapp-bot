import type {PoolClient} from 'pg';

export async function migrateDeveloperDiagnostics(c:PoolClient){
 if((await c.query('SELECT 1 FROM schema_migrations WHERE version=48')).rowCount){
  if(!(await c.query("SELECT to_regclass('developer_diagnostic_reports') AS relation")).rows[0].relation)throw Error('Migration 48 collision: reconcile developer diagnostics before upgrading.');
  return;
 }
 await c.query(`
 CREATE TABLE developer_diagnostic_snapshots(
  store_id uuid NOT NULL REFERENCES stores(id),id uuid NOT NULL,actor text NOT NULL,input_hash text NOT NULL,
  range_start timestamptz NOT NULL,range_end timestamptz NOT NULL,result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,id)
 );
 CREATE TABLE developer_diagnostic_reports(
  store_id uuid NOT NULL REFERENCES stores(id),id uuid NOT NULL,actor text NOT NULL,input_hash text NOT NULL,
  report jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,id)
 );
 CREATE INDEX developer_diagnostic_reports_recent ON developer_diagnostic_reports(store_id,created_at DESC,id);
 INSERT INTO schema_migrations(version) VALUES(48);
 `);
}

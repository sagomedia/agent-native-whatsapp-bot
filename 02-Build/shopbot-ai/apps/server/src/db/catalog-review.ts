import type {PoolClient} from 'pg';
export async function migrateCatalogReview(c:PoolClient){
 if((await c.query('SELECT 1 FROM schema_migrations WHERE version=52')).rowCount){
  if(!(await c.query("SELECT to_regclass('catalog_review_feedback') AS relation")).rows[0].relation)throw Error('Migration 52 collision: reconcile catalog review before upgrading.');
  return;
 }
 await c.query(`ALTER TABLE catalog_audit_findings ADD COLUMN explanation_ta text;
 CREATE TABLE catalog_review_feedback(
  store_id uuid NOT NULL, id uuid NOT NULL, finding_id uuid NOT NULL, audit_id uuid NOT NULL,
  finding_version integer NOT NULL, decision text NOT NULL CHECK(decision IN ('approve','reject')),
  audio bytea, audio_mime text, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  PRIMARY KEY(store_id,id), FOREIGN KEY(store_id,finding_id) REFERENCES catalog_audit_findings(store_id,id),
  FOREIGN KEY(store_id,audit_id) REFERENCES catalog_audit_runs(store_id,id),
  CHECK ((audio IS NULL AND audio_mime IS NULL) OR (audio IS NOT NULL AND audio_mime IS NOT NULL))
 );
 CREATE INDEX catalog_review_feedback_pending ON catalog_review_feedback(store_id,state,created_at);
 INSERT INTO schema_migrations(version) VALUES(52);`);
}

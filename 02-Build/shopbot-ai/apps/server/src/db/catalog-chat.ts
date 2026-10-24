import type {PoolClient} from 'pg';

// Allocate against the latest source when integrating this isolated branch.
export async function migrateCatalogChat(c:PoolClient){
 if((await c.query('SELECT 1 FROM schema_migrations WHERE version=47')).rowCount){
  if(!(await c.query("SELECT to_regclass('catalog_chat_reviews') AS relation")).rows[0].relation)throw Error('Migration 47 collision: reconcile catalog chat before upgrading.');
  return;
 }
 await c.query(`
  ALTER TABLE catalog_proposal_assets ADD COLUMN asset_kind text NOT NULL DEFAULT 'original' CHECK(asset_kind IN ('original','cleaned','marketing')),
    ADD COLUMN source_asset_id uuid;
  ALTER TABLE catalog_proposal_assets ADD CONSTRAINT catalog_asset_identity UNIQUE(store_id,proposal_id,id);
  ALTER TABLE catalog_proposal_assets ADD CONSTRAINT catalog_asset_source FOREIGN KEY(store_id,proposal_id,source_asset_id) REFERENCES catalog_proposal_assets(store_id,proposal_id,id);
  CREATE TABLE catalog_chat_reviews(
    id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),proposal_id uuid NOT NULL,
    proposal_version integer NOT NULL,actor text NOT NULL,input_hash text NOT NULL,snapshot jsonb NOT NULL,
    expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(store_id,proposal_id) REFERENCES catalog_proposals(store_id,id)
  );
  CREATE INDEX catalog_chat_review_proposal ON catalog_chat_reviews(store_id,proposal_id);
  CREATE TABLE catalog_chat_operations(
    store_id uuid NOT NULL REFERENCES stores(id),id uuid NOT NULL,actor text NOT NULL,action text NOT NULL,
    input_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,id)
  );
  INSERT INTO schema_migrations(version) VALUES(47);
 `);
}

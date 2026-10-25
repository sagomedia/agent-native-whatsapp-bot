import type {PoolClient} from 'pg';

export async function migrateCatalogAudit(c:PoolClient){
 if((await c.query('SELECT 1 FROM schema_migrations WHERE version=50')).rowCount){
  if(!(await c.query("SELECT to_regclass('catalog_audit_runs') AS relation")).rows[0].relation)throw Error('Migration 50 collision: reconcile catalog audit before upgrading.');
  return;
 }
 await c.query(`
 ALTER TABLE conversations ADD COLUMN active_item_id text;
 CREATE TABLE catalog_audit_runs(
  store_id uuid NOT NULL REFERENCES stores(id),id uuid NOT NULL,title text NOT NULL,actor text NOT NULL,
  version integer NOT NULL DEFAULT 1,range_start timestamptz NOT NULL,range_end timestamptz NOT NULL,
  coverage jsonb NOT NULL DEFAULT '{}',summary text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(store_id,id)
 );
 CREATE TABLE catalog_audit_findings(
  store_id uuid NOT NULL,audit_id uuid NOT NULL,id uuid NOT NULL,version integer NOT NULL DEFAULT 1,
  category text NOT NULL,status text NOT NULL CHECK(status IN ('needs_review','applied','dismissed','undone')),
  sku text,wording text NOT NULL,explanation text NOT NULL,patch jsonb NOT NULL,evidence jsonb NOT NULL,
  expected_product_version integer,applied_operation uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(store_id,id),FOREIGN KEY(store_id,audit_id) REFERENCES catalog_audit_runs(store_id,id),FOREIGN KEY(store_id,sku) REFERENCES products(store_id,sku)
 );
 CREATE INDEX catalog_audit_findings_queue ON catalog_audit_findings(store_id,status,created_at DESC,id);
 CREATE TABLE catalog_audit_reviews(
  store_id uuid NOT NULL,audit_id uuid NOT NULL,message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY(store_id,audit_id,message_id),FOREIGN KEY(store_id,audit_id) REFERENCES catalog_audit_runs(store_id,id)
 );
 CREATE TABLE catalog_change_events(
  sequence bigserial PRIMARY KEY,id uuid NOT NULL DEFAULT gen_random_uuid(),store_id uuid NOT NULL REFERENCES stores(id),
  operation_id uuid NOT NULL,sku text NOT NULL,actor text NOT NULL,application_name text NOT NULL,
  grant_id uuid,action text NOT NULL,source text NOT NULL CHECK(source IN ('mcp','audit','legacy')),
  audit_id uuid,before_values jsonb,after_values jsonb,before_version integer,after_version integer,
  undone_by uuid,historical boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id,id),UNIQUE(store_id,operation_id,sku),FOREIGN KEY(store_id,audit_id) REFERENCES catalog_audit_runs(store_id,id)
 );
 CREATE INDEX catalog_change_events_recent ON catalog_change_events(store_id,sequence DESC);
 CREATE INDEX catalog_change_events_product ON catalog_change_events(store_id,sku,sequence DESC);
 CREATE TABLE conversation_audit_events(
  store_id uuid NOT NULL REFERENCES stores(id),message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id),evidence jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(store_id,message_id)
 );
 CREATE FUNCTION record_connected_catalog_change() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE context jsonb; before_data jsonb; after_data jsonb;
 BEGIN
  context:=nullif(current_setting('shopbot.mcp_origin',true),'')::jsonb;
  IF context IS NULL OR context->>'storeId'<>NEW.store_id::text THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN before_data:=to_jsonb(OLD)-ARRAY['search_text','search_vector','inventory_updated_at','version','inventory_version']; END IF;
  after_data:=to_jsonb(NEW)-ARRAY['search_text','search_vector','inventory_updated_at','version','inventory_version'];
  IF before_data IS NOT DISTINCT FROM after_data THEN RETURN NEW; END IF;
  INSERT INTO catalog_change_events(store_id,operation_id,sku,actor,application_name,grant_id,action,source,audit_id,before_values,after_values,before_version,after_version)
  VALUES(NEW.store_id,(context->>'operationId')::uuid,NEW.sku,context->>'actor',context->>'applicationName',(context->>'grantId')::uuid,context->>'action',context->>'source',(context->>'auditId')::uuid,before_data,after_data,CASE WHEN TG_OP='UPDATE' THEN OLD.version ELSE NULL END,NEW.version)
  ON CONFLICT(store_id,operation_id,sku) DO UPDATE SET after_values=EXCLUDED.after_values,after_version=EXCLUDED.after_version;
  RETURN NEW;
 END; $$;
 CREATE TRIGGER products_connected_activity AFTER INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION record_connected_catalog_change();
 INSERT INTO catalog_change_events(store_id,operation_id,sku,actor,application_name,action,source,historical,created_at)
 SELECT o.store_id,o.id,p.sku,o.actor,coalesce(cl.name,'Connected AI application'),o.action,'legacy',true,o.created_at
 FROM catalog_chat_operations o JOIN products p ON p.store_id=o.store_id AND p.sku=coalesce(o.result->>'sku',o.result->'product'->>'sku')
 LEFT JOIN mcp_oauth_grants g ON o.actor LIKE '%/mcp/'||g.id::text LEFT JOIN mcp_oauth_clients cl ON cl.client_id=g.client_id
 WHERE o.action IN ('add_product','commit','import_item','import_apply','stock','visibility')
 ON CONFLICT(store_id,operation_id,sku) DO NOTHING;
 INSERT INTO schema_migrations(version) VALUES(50);
 `);
}

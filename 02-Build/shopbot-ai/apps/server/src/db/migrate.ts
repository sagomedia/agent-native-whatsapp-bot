import type { Pool } from 'pg';
import type { Config } from '../config.js';
import { assertMock } from '../config.js';
import { fixtureStore, fixtureConversation, hardwareFixtures } from '../../../../profiles/hardware.js';

const migration = `
CREATE TABLE stores (id uuid PRIMARY KEY, name text NOT NULL, synthetic text NOT NULL);
CREATE TABLE products (store_id uuid NOT NULL REFERENCES stores(id), sku text NOT NULL, name text NOT NULL, unit text NOT NULL, price_paise integer NOT NULL CHECK(price_paise >= 0), stock integer CHECK(stock >= 0), version integer NOT NULL DEFAULT 1, PRIMARY KEY(store_id, sku));
CREATE TABLE conversations (id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id), actor text NOT NULL, version integer NOT NULL DEFAULT 0, draft jsonb NOT NULL DEFAULT '[]');
CREATE TABLE messages (sequence bigserial PRIMARY KEY, id uuid NOT NULL UNIQUE, conversation_id uuid NOT NULL REFERENCES conversations(id), direction text NOT NULL CHECK(direction IN ('inbound','outbound')), text text NOT NULL, status text NOT NULL CHECK(status IN ('pending','processed','sent')), payload jsonb, response_to uuid UNIQUE REFERENCES messages(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX messages_pending_idx ON messages(sequence) WHERE status = 'pending';
`;
const migration2 = `
ALTER TABLE products ADD COLUMN aliases jsonb NOT NULL DEFAULT '[]', ADD COLUMN quantity_step numeric(8,3) NOT NULL DEFAULT 1 CHECK(quantity_step>0), ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE conversations ADD COLUMN pending jsonb, ADD COLUMN fulfillment text NOT NULL DEFAULT 'pickup', ADD COLUMN last_request_id uuid;
ALTER TABLE conversations ADD CONSTRAINT conversations_scope_unique UNIQUE(store_id,id,actor);
ALTER TABLE messages DROP CONSTRAINT messages_status_check;
ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK(status IN ('pending','processing','processed','sent'));
ALTER TABLE messages ADD COLUMN binding_id uuid, ADD COLUMN claim_token uuid, ADD COLUMN lease_until timestamptz;
CREATE TABLE order_requests (id uuid PRIMARY KEY, store_id uuid NOT NULL, conversation_id uuid NOT NULL, actor text NOT NULL, review_id uuid NOT NULL UNIQUE, lines jsonb NOT NULL, total_paise bigint NOT NULL CHECK(total_paise>=0), acceptance text NOT NULL DEFAULT 'awaiting_approval', payment text NOT NULL DEFAULT 'not_requested', fulfillment text NOT NULL DEFAULT 'awaiting_approval', pickup_method text NOT NULL DEFAULT 'pickup', created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(store_id,conversation_id,actor) REFERENCES conversations(store_id,id,actor));
CREATE TABLE tool_receipts (store_id uuid NOT NULL, conversation_id uuid NOT NULL, actor text NOT NULL, operation_key text NOT NULL, tool_name text NOT NULL, args_hash text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(store_id,conversation_id,operation_key,tool_name), FOREIGN KEY(store_id,conversation_id,actor) REFERENCES conversations(store_id,id,actor));
CREATE TABLE provider_attempts (id uuid PRIMARY KEY, store_id uuid NOT NULL, conversation_id uuid NOT NULL, actor text NOT NULL, message_id uuid NOT NULL REFERENCES messages(id), attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 2), provider text NOT NULL, source_version integer NOT NULL, state text NOT NULL CHECK(state IN ('started','succeeded','failed','unknown')), response jsonb, usage jsonb, provider_cost_paise numeric(20,8), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(message_id,attempt), FOREIGN KEY(store_id,conversation_id,actor) REFERENCES conversations(store_id,id,actor));
`;
const migration3 = `
CREATE TABLE inference_budgets (store_id uuid PRIMARY KEY REFERENCES stores(id), limit_microusd bigint NOT NULL CHECK(limit_microusd>0), committed_microusd bigint NOT NULL DEFAULT 0 CHECK(committed_microusd>=0), held_microusd bigint NOT NULL DEFAULT 0 CHECK(held_microusd>=0), blocked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE provider_attempts ADD COLUMN provider_mode text NOT NULL DEFAULT 'mock' CHECK(provider_mode IN ('mock','live')), ADD COLUMN billing_state text NOT NULL DEFAULT 'not_billable' CHECK(billing_state IN ('not_billable','held','estimated','unknown')), ADD COLUMN rate_snapshot jsonb, ADD COLUMN reserved_microusd bigint NOT NULL DEFAULT 0 CHECK(reserved_microusd>=0), ADD COLUMN estimated_cost_microusd bigint CHECK(estimated_cost_microusd>=0), ADD COLUMN response_model text, ADD COLUMN settled_at timestamptz;
`;
const migration4 = `
CREATE TABLE free_inference_quota (scope text NOT NULL, model text NOT NULL, cooldown_until timestamptz, PRIMARY KEY(scope,model));
ALTER TABLE provider_attempts ADD COLUMN quota_scope text;
ALTER TABLE provider_attempts DROP CONSTRAINT provider_attempts_billing_state_check;
ALTER TABLE provider_attempts ADD CONSTRAINT provider_attempts_billing_state_check CHECK(billing_state IN ('not_billable','free_declared','held','estimated','unknown'));
CREATE INDEX free_attempt_quota_idx ON provider_attempts(quota_scope,provider,created_at) WHERE quota_scope IS NOT NULL;
`;
export async function setupDatabase(pool: Pool, mode: Config['mode']) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(17012026)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const result = await client.query('SELECT version FROM schema_migrations WHERE version = 1');
    if (!result.rowCount) {
      await client.query(migration);
      await client.query('INSERT INTO schema_migrations(version) VALUES(1)');
    }
    const v2 = await client.query('SELECT version FROM schema_migrations WHERE version=2');
    if (!v2.rowCount) { await client.query(migration2); await client.query('INSERT INTO schema_migrations(version) VALUES(2)'); }
    const v3 = await client.query('SELECT version FROM schema_migrations WHERE version=3');
    if (!v3.rowCount) {await client.query(migration3);await client.query('INSERT INTO schema_migrations(version) VALUES(3)');}
    const v4 = await client.query('SELECT version FROM schema_migrations WHERE version=4');
    if (!v4.rowCount) {await client.query(migration4);await client.query('INSERT INTO schema_migrations(version) VALUES(4)');}
    const v5 = await client.query('SELECT version FROM schema_migrations WHERE version=5');
    if (!v5.rowCount) {await client.query('ALTER TABLE provider_attempts ADD COLUMN failure_code text');await client.query('INSERT INTO schema_migrations(version) VALUES(5)');}
    const v6=await client.query('SELECT version FROM schema_migrations WHERE version=6');
    if(!v6.rowCount){await client.query("ALTER TABLE products ADD COLUMN category text, ADD COLUMN image_path text");await client.query('INSERT INTO schema_migrations(version) VALUES(6)');}
    const v7=await client.query('SELECT version FROM schema_migrations WHERE version=7');
    if(!v7.rowCount){await client.query('ALTER TABLE conversations ADD COLUMN assistant_memory jsonb');await client.query('INSERT INTO schema_migrations(version) VALUES(7)');}
    const v8=await client.query('SELECT version FROM schema_migrations WHERE version=8');
    if(!v8.rowCount){await client.query('CREATE TABLE store_policies(store_id uuid PRIMARY KEY REFERENCES stores(id),require_product_confirmation boolean NOT NULL DEFAULT false)');await client.query('INSERT INTO schema_migrations(version) VALUES(8)');}
    const v9=await client.query('SELECT version FROM schema_migrations WHERE version=9');
    if(!v9.rowCount){await client.query(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
      CREATE TABLE catalog_profiles(store_id uuid PRIMARY KEY REFERENCES stores(id),store_type text NOT NULL);
      CREATE TABLE catalog_nodes(store_id uuid NOT NULL REFERENCES stores(id),id text NOT NULL,parent_id text,kind text NOT NULL CHECK(kind IN ('department','family')),label text NOT NULL,aliases jsonb NOT NULL DEFAULT '[]',PRIMARY KEY(store_id,id),FOREIGN KEY(store_id,parent_id) REFERENCES catalog_nodes(store_id,id));
      ALTER TABLE products ADD COLUMN family_id text,ADD COLUMN brand text,ADD COLUMN specifications jsonb NOT NULL DEFAULT '{}',ADD COLUMN keywords jsonb NOT NULL DEFAULT '[]';
      ALTER TABLE products ADD CONSTRAINT products_family_fk FOREIGN KEY(store_id,family_id) REFERENCES catalog_nodes(store_id,id);
      ALTER TABLE products ADD COLUMN search_text text GENERATED ALWAYS AS (lower(name||' '||sku||' '||aliases::text||' '||coalesce(category,'')||' '||coalesce(brand,'')||' '||specifications::text||' '||keywords::text)) STORED;
      ALTER TABLE products ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',name||' '||sku||' '||aliases::text||' '||coalesce(category,'')||' '||coalesce(brand,'')||' '||specifications::text||' '||keywords::text)) STORED;
      CREATE INDEX products_search_fts ON products USING gin(search_vector) WHERE active=true;
      CREATE INDEX products_search_trgm ON products USING gin(search_text public.gin_trgm_ops) WHERE active=true;
      CREATE INDEX products_family_brand ON products(store_id,family_id,brand) WHERE active=true;
      INSERT INTO schema_migrations(version) VALUES(9);
    `);}
    const v10=await client.query('SELECT version FROM schema_migrations WHERE version=10');
    if(!v10.rowCount){await client.query(`CREATE TABLE voice_media(id uuid PRIMARY KEY,store_id uuid NOT NULL,conversation_id uuid NOT NULL,actor text NOT NULL,source_hash text NOT NULL,audio bytea NOT NULL CHECK(octet_length(audio)<=960044),duration_seconds double precision NOT NULL CHECK(duration_seconds>0 AND duration_seconds<=30),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(store_id,conversation_id,actor) REFERENCES conversations(store_id,id,actor)); INSERT INTO schema_migrations(version) VALUES(10);`);}
    const v11=await client.query('SELECT version FROM schema_migrations WHERE version=11');
    if(!v11.rowCount){await client.query('ALTER TABLE voice_media ADD COLUMN source_version integer NOT NULL DEFAULT 0 CHECK(source_version>=0)');await client.query('INSERT INTO schema_migrations(version) VALUES(11)');}
    const v12=await client.query('SELECT version FROM schema_migrations WHERE version=12');
    if(!v12.rowCount){await client.query(`CREATE TABLE image_media(id uuid PRIMARY KEY,store_id uuid NOT NULL,conversation_id uuid NOT NULL,actor text NOT NULL,source_hash text NOT NULL,image bytea NOT NULL CHECK(octet_length(image)<=2097152),width integer NOT NULL CHECK(width>0 AND width<=1280),height integer NOT NULL CHECK(height>0 AND height<=1280),source_version integer NOT NULL CHECK(source_version>=0),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(store_id,conversation_id,actor) REFERENCES conversations(store_id,id,actor)); INSERT INTO schema_migrations(version) VALUES(12);`);}
    const v13=await client.query('SELECT version FROM schema_migrations WHERE version=13');
    if(!v13.rowCount){await client.query('ALTER TABLE provider_attempts ADD COLUMN validation_issues jsonb');await client.query('INSERT INTO schema_migrations(version) VALUES(13)');}
    const v14=await client.query('SELECT version FROM schema_migrations WHERE version=14');
    if(!v14.rowCount){await client.query(`
      ALTER TABLE conversations ADD COLUMN reply_language text NOT NULL DEFAULT 'en' CHECK(reply_language IN ('ta','ta-Latn','en'));
      UPDATE conversations SET reply_language='ta' WHERE actor='local-ai-test';
      ALTER TABLE products ADD COLUMN local_names jsonb NOT NULL DEFAULT '{}';
      ALTER TABLE catalog_nodes ADD COLUMN local_names jsonb NOT NULL DEFAULT '{}';
      INSERT INTO schema_migrations(version) VALUES(14);
    `);}
    const v15=await client.query('SELECT version FROM schema_migrations WHERE version=15');
    if(!v15.rowCount){await client.query(`
      ALTER TABLE stores ADD COLUMN operator_paused boolean NOT NULL DEFAULT false, ADD COLUMN operator_revision integer NOT NULL DEFAULT 0;
      ALTER TABLE conversations ADD COLUMN operator_mode text NOT NULL DEFAULT 'assistant' CHECK(operator_mode IN ('assistant','owner')), ADD COLUMN operator_revision integer NOT NULL DEFAULT 0;
      CREATE TABLE owner_audit(sequence bigserial PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),email text NOT NULL,action text NOT NULL,target_id uuid NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO schema_migrations(version) VALUES(15);
    `);}
    if (mode === 'mock') {
      assertMock(mode);
      await client.query('INSERT INTO stores(id,name,synthetic) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [fixtureStore, 'Workshop supply demo', 'true']);
      await client.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [fixtureConversation, fixtureStore, 'local-simulator']);
      for (const p of hardwareFixtures) await client.query('INSERT INTO products(store_id,sku,name,unit,price_paise,stock) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [fixtureStore, p.sku, p.name, p.unit, p.pricePaise, p.stock]);
    }
    if (mode === 'mock') {
      const aliases: Record<string,string[]> = { 'PTFE-TAPE': ['PTFE tape','Teflon tape','tape rolls'], 'PVC-ELBOW-050': ['half inch elbow','0.5 inch PVC elbow'], 'PVC-ELBOW-075':['0.75 inch PVC elbow'], 'WRENCH-10':['ten inch wrench','adjustable wrench'], 'SCREW-M4-25':['M4 screws'], 'HAMMER-500':['claw hammer'] };
      for (const [sku,values] of Object.entries(aliases)) await client.query("UPDATE products SET aliases=$1::jsonb WHERE store_id=$2 AND sku=$3 AND aliases='[]'::jsonb",[JSON.stringify(values),fixtureStore,sku]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function resetMock(pool: Pool, mode: Config['mode']) {
  assertMock(mode);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(17012026)');
    // Refuse a mixed database; never truncate merchant records.
    const real = await client.query("SELECT id FROM stores WHERE synthetic <> 'true'");
    if (real.rowCount) throw new Error('Mock reset refused: database contains non-demo stores');
    await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE',[fixtureConversation]);
    const paid = await client.query("SELECT 1 FROM provider_attempts WHERE conversation_id=$1 AND provider_mode='live' LIMIT 1",[fixtureConversation]);
    if(paid.rowCount) throw new Error('Mock reset refused: conversation contains paid inference accounting');
    await client.query('DELETE FROM provider_attempts WHERE conversation_id=$1',[fixtureConversation]);
    await client.query('DELETE FROM tool_receipts WHERE conversation_id=$1',[fixtureConversation]);
    await client.query('DELETE FROM order_requests WHERE conversation_id=$1',[fixtureConversation]);
    await client.query('DELETE FROM messages WHERE conversation_id = $1', [fixtureConversation]);
    await client.query("UPDATE conversations SET draft='[]', pending=NULL, assistant_memory=NULL, last_request_id=NULL, version=version+1 WHERE id=$1", [fixtureConversation]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

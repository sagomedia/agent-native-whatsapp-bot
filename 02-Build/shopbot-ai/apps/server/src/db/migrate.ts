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
    const v16=await client.query('SELECT version FROM schema_migrations WHERE version=16');
    if(!v16.rowCount){await client.query(`
      CREATE TABLE whatsapp_channels(phone_id text PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),app_id text NOT NULL,waba_id text NOT NULL,verified_at timestamptz,last_webhook_at timestamptz,last_received_at timestamptz,send_blocked boolean NOT NULL DEFAULT false,last_error text);
      CREATE TABLE whatsapp_conversations(conversation_id uuid PRIMARY KEY REFERENCES conversations(id),phone_id text NOT NULL REFERENCES whatsapp_channels(phone_id),recipient text NOT NULL,last_inbound_at timestamptz NOT NULL,UNIQUE(phone_id,recipient));
      CREATE TABLE whatsapp_inbound(phone_id text NOT NULL REFERENCES whatsapp_channels(phone_id),provider_id text NOT NULL,message_id uuid NOT NULL UNIQUE REFERENCES messages(id),PRIMARY KEY(phone_id,provider_id));
      ALTER TABLE messages DROP CONSTRAINT messages_status_check;
      ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK(status IN ('pending','processing','processed','sent','queued','sending','accepted','delivered','read','failed','unknown','blocked','cancelled'));
      CREATE TABLE whatsapp_outbox(message_id uuid PRIMARY KEY REFERENCES messages(id),conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(conversation_id),state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','accepted','delivered','read','failed','unknown','blocked','cancelled')),provider_id text UNIQUE,operator_revision integer NOT NULL,attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE whatsapp_statuses(phone_id text NOT NULL,provider_id text NOT NULL,recipient text NOT NULL,state text NOT NULL CHECK(state IN ('sent','delivered','read','failed')),provider_timestamp bigint NOT NULL,callback_id uuid,error_code integer,PRIMARY KEY(phone_id,provider_id,state,provider_timestamp));
      CREATE INDEX whatsapp_outbox_pending ON whatsapp_outbox(next_attempt_at) WHERE state='queued';
      INSERT INTO schema_migrations(version) VALUES(16);
    `);}
    const v17=await client.query('SELECT version FROM schema_migrations WHERE version=17');
    if(!v17.rowCount){await client.query(`
      ALTER TABLE whatsapp_outbox ADD COLUMN reply_payload jsonb;
      CREATE TABLE whatsapp_actions(id text PRIMARY KEY,message_id uuid NOT NULL REFERENCES whatsapp_outbox(message_id),conversation_id uuid NOT NULL REFERENCES conversations(id),event jsonb NOT NULL,label text NOT NULL,source_version integer NOT NULL,operator_revision integer NOT NULL,binding_id uuid,expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours');
      CREATE INDEX whatsapp_actions_conversation ON whatsapp_actions(conversation_id,message_id);
      INSERT INTO schema_migrations(version) VALUES(17);
    `);}
    const v18=await client.query('SELECT version FROM schema_migrations WHERE version=18');
    if(!v18.rowCount){await client.query(`
      ALTER TABLE conversations ADD COLUMN editing_line_id uuid, ADD COLUMN handoff_requested boolean NOT NULL DEFAULT false, ADD COLUMN session_started_at timestamptz;
      ALTER TABLE whatsapp_outbox ADD COLUMN sender_kind text NOT NULL DEFAULT 'assistant' CHECK(sender_kind IN ('assistant','owner','system'));
      ALTER TABLE provider_attempts ADD COLUMN stage text NOT NULL DEFAULT 'identify' CHECK(stage IN ('identify','recommend'));
      ALTER TABLE messages ADD COLUMN not_before timestamptz;
      CREATE TABLE whatsapp_media(message_id uuid PRIMARY KEY REFERENCES messages(id),media_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('image','voice')),source_version integer NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','fetching','ready','failed')),lease_until timestamptz,last_error text);
      INSERT INTO schema_migrations(version) VALUES(18);
    `);}
    const v19=await client.query('SELECT version FROM schema_migrations WHERE version=19');
    if(!v19.rowCount){await client.query('ALTER TABLE messages ADD COLUMN typing_indicated_at timestamptz');await client.query('INSERT INTO schema_migrations(version) VALUES(19)');}
    const v20=await client.query('SELECT version FROM schema_migrations WHERE version=20');
    if(!v20.rowCount){await client.query("ALTER TABLE provider_attempts DROP CONSTRAINT provider_attempts_stage_check; ALTER TABLE provider_attempts ADD CONSTRAINT provider_attempts_stage_check CHECK(stage IN ('recognize','identify','recommend')); ALTER TABLE provider_attempts DROP CONSTRAINT provider_attempts_attempt_check; ALTER TABLE provider_attempts ADD CONSTRAINT provider_attempts_attempt_check CHECK(attempt BETWEEN 1 AND 3); INSERT INTO schema_migrations(version) VALUES(20)");}
    const v21=await client.query('SELECT version FROM schema_migrations WHERE version=21');
    if(!v21.rowCount){await client.query(`
      ALTER TABLE products ADD COLUMN catalog_origin text NOT NULL DEFAULT 'legacy' CHECK(catalog_origin IN ('legacy','demo','owner')),ADD COLUMN inventory_updated_at timestamptz;
      UPDATE products SET catalog_origin='demo' WHERE image_path LIKE '/demo-images/%';
      CREATE TABLE catalog_photos(id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),image bytea NOT NULL CHECK(octet_length(image)<=2097152),width integer NOT NULL,height integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE request_notifications(request_id uuid NOT NULL REFERENCES order_requests(id),status_key text NOT NULL,message_id uuid NOT NULL UNIQUE REFERENCES messages(id),PRIMARY KEY(request_id,status_key));
      INSERT INTO schema_migrations(version) VALUES(21);
    `);}
    const v22=await client.query('SELECT version FROM schema_migrations WHERE version=22');
    if(!v22.rowCount){await client.query(`CREATE TABLE catalog_suggestions(id uuid NOT NULL,store_id uuid NOT NULL REFERENCES stores(id),input_hash text NOT NULL,state text NOT NULL CHECK(state IN ('started','succeeded','failed','unknown')),provider_mode text NOT NULL CHECK(provider_mode IN ('mock','live')),rate_snapshot jsonb NOT NULL,reserved_microusd bigint NOT NULL DEFAULT 0,estimated_cost_microusd bigint,usage jsonb,response_model text,suggestion jsonb,billing_state text NOT NULL DEFAULT 'held' CHECK(billing_state IN ('held','estimated','unknown')),created_at timestamptz NOT NULL DEFAULT now(),settled_at timestamptz,PRIMARY KEY(store_id,id)); INSERT INTO schema_migrations(version) VALUES(22)`);}
    if (mode === 'mock') {
      assertMock(mode);
      await client.query('INSERT INTO stores(id,name,synthetic) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [fixtureStore, 'Workshop supply demo', 'true']);
      await client.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [fixtureConversation, fixtureStore, 'local-simulator']);
      for (const p of hardwareFixtures) await client.query('INSERT INTO products(store_id,sku,name,unit,price_paise,stock) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [fixtureStore, p.sku, p.name, p.unit, p.pricePaise, p.stock]);
    }
    if (mode === 'mock') {
      const aliases: Record<string,string[]> = { 'PTFE-TAPE': ['PTFE tape','Teflon tape','tape rolls'], 'PVC-ELBOW-050': ['half inch elbow','0.5 inch PVC elbow'], 'PVC-ELBOW-075':['0.75 inch PVC elbow'], 'WRENCH-10':['ten inch wrench','adjustable wrench'], 'SCREW-M4-25':['M4 screws'], 'HAMMER-500':['claw hammer'] };
      for (const [sku,values] of Object.entries(aliases)) await client.query("UPDATE products SET aliases=$1::jsonb WHERE store_id=$2 AND sku=$3 AND aliases='[]'::jsonb AND catalog_origin<>'owner'",[JSON.stringify(values),fixtureStore,sku]);
    }
    const v23=await client.query('SELECT version FROM schema_migrations WHERE version=23');
    if(!v23.rowCount){await client.query(`
      ALTER TABLE conversations ADD COLUMN visual_ordering boolean NOT NULL DEFAULT false, ADD COLUMN product_review jsonb;
      ALTER TABLE messages DROP CONSTRAINT messages_response_to_key;
      ALTER TABLE messages ADD COLUMN reply_group_id uuid, ADD COLUMN part_index integer NOT NULL DEFAULT 0 CHECK(part_index>=0), ADD COLUMN part_count integer NOT NULL DEFAULT 1 CHECK(part_count>0), ADD COLUMN stage text, ADD COLUMN clarification_reason text;
      ALTER TABLE messages ADD CONSTRAINT messages_response_part_unique UNIQUE(response_to,part_index);
      CREATE INDEX messages_reply_group ON messages(reply_group_id,part_index);
      INSERT INTO schema_migrations(version) VALUES(23);
    `);}
    const v24=await client.query('SELECT version FROM schema_migrations WHERE version=24');
    if(!v24.rowCount){await client.query("ALTER TABLE provider_attempts DROP CONSTRAINT provider_attempts_attempt_check; ALTER TABLE provider_attempts ADD CONSTRAINT provider_attempts_attempt_check CHECK(attempt BETWEEN 1 AND 4); INSERT INTO schema_migrations(version) VALUES(24)");}
    const v25=await client.query('SELECT version FROM schema_migrations WHERE version=25');
    if(!v25.rowCount){await client.query(`
      ALTER TABLE stores ADD COLUMN catalog_revision integer NOT NULL DEFAULT 1;
      ALTER TABLE conversations ADD COLUMN reply_language_explicit boolean NOT NULL DEFAULT false;
      ALTER TABLE provider_attempts DROP CONSTRAINT provider_attempts_stage_check;
      ALTER TABLE provider_attempts ADD CONSTRAINT provider_attempts_stage_check CHECK(stage IN ('recognize','identify','repair','recommend')); 
      ALTER TABLE products ADD COLUMN price_status text NOT NULL DEFAULT 'priced' CHECK(price_status IN ('priced','confirm','free')), ADD COLUMN selling_unit_verified boolean NOT NULL DEFAULT false;
      UPDATE products SET price_status='confirm' WHERE price_paise=0;
      CREATE FUNCTION bump_shop_catalog_revision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE stores SET catalog_revision=catalog_revision+1 WHERE id=COALESCE(NEW.store_id,OLD.store_id);
        RETURN NULL;
      END $$;
      CREATE TRIGGER products_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION bump_shop_catalog_revision();
      CREATE TRIGGER nodes_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON catalog_nodes FOR EACH ROW EXECUTE FUNCTION bump_shop_catalog_revision();
      INSERT INTO schema_migrations(version) VALUES(25);
    `);}
    const v26=await client.query('SELECT version FROM schema_migrations WHERE version=26');
    if(!v26.rowCount){await client.query(`
      ALTER TABLE image_media DROP CONSTRAINT image_media_width_check;
      ALTER TABLE image_media DROP CONSTRAINT image_media_height_check;
      ALTER TABLE image_media ADD CONSTRAINT image_media_width_check CHECK(width>0 AND width<=2048);
      ALTER TABLE image_media ADD CONSTRAINT image_media_height_check CHECK(height>0 AND height<=2048);
      INSERT INTO schema_migrations(version) VALUES(26);
    `);}
    const v27=await client.query('SELECT version FROM schema_migrations WHERE version=27');
    if(!v27.rowCount){await client.query(`
      ALTER TABLE messages ADD COLUMN inference_deadline_at timestamptz;
      ALTER TABLE provider_attempts ADD COLUMN input_admission jsonb;
      ALTER TABLE catalog_suggestions ADD COLUMN input_admission jsonb;
      ALTER TABLE whatsapp_statuses ADD COLUMN pricing jsonb;
      CREATE TABLE whatsapp_pricing_events (
        store_id uuid NOT NULL REFERENCES stores(id), phone_id text NOT NULL, provider_id text NOT NULL,
        recipient text NOT NULL, state text NOT NULL, provider_timestamp bigint NOT NULL,
        pricing jsonb, pricing_hash text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(phone_id,provider_id,recipient,state,provider_timestamp,pricing_hash)
      );
      CREATE TABLE whatsapp_delivery_costs (
        store_id uuid NOT NULL REFERENCES stores(id),phone_id text NOT NULL,provider_id text NOT NULL,
        recipient text NOT NULL,delivered_at timestamptz NOT NULL,account_timezone text,billing_month text,
        category text,pricing_type text,billable boolean,pricing_model text,
        currency text,market text,estimated_microunits bigint CHECK(estimated_microunits>=0),rate_snapshot jsonb,
        state text NOT NULL CHECK(state IN ('free','estimated','unknown','conflicting')),source text NOT NULL DEFAULT 'signed_webhook',
        PRIMARY KEY(phone_id,provider_id)
      );
      CREATE INDEX whatsapp_delivery_costs_month ON whatsapp_delivery_costs(store_id,phone_id,billing_month,category);
      CREATE TABLE whatsapp_delivery_cost_history (
        id bigserial PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),phone_id text NOT NULL,provider_id text NOT NULL,
        prior_snapshot jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE whatsapp_pricing_analytics (
        id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),phone_id text NOT NULL,
        account_timezone text NOT NULL,currency text NOT NULL,range_start bigint NOT NULL,range_end bigint NOT NULL,
        response_hash text NOT NULL,payload jsonb NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(phone_id,range_start,range_end,response_hash)
      );
      INSERT INTO schema_migrations(version) VALUES(27);
    `);}
    const v28=await client.query('SELECT version FROM schema_migrations WHERE version=28');
    if(!v28.rowCount){await client.query(`ALTER TABLE provider_attempts ADD COLUMN observation jsonb; INSERT INTO schema_migrations(version) VALUES(28);`);}
    const v29=await client.query('SELECT version FROM schema_migrations WHERE version=29');
    if(!v29.rowCount){await client.query(`
      ALTER TABLE products ADD COLUMN merchant_verification jsonb NOT NULL DEFAULT '{"identity":false,"photo":false,"sellingUnit":false,"price":false,"stock":false}';
      ALTER TABLE products ADD COLUMN selling_policy jsonb NOT NULL DEFAULT '{"cutAllowed":false,"continuousLengthAvailable":null}';
      CREATE TABLE catalog_proposals (
        id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),batch_id text NOT NULL,client_item_id text NOT NULL,
        input_hash text NOT NULL,details jsonb NOT NULL,provenance jsonb NOT NULL,actor text NOT NULL,
        base_sku text,base_version integer,version integer NOT NULL DEFAULT 1,
        state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','rejected')),
        published_sku text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(store_id,batch_id,client_item_id),UNIQUE(store_id,id)
      );
      CREATE INDEX catalog_proposals_pending ON catalog_proposals(store_id,state,created_at);
      CREATE TABLE catalog_proposal_assets (
        id uuid PRIMARY KEY,store_id uuid NOT NULL,proposal_id uuid NOT NULL,
        original bytea NOT NULL CHECK(octet_length(original)<=2097152),mime_type text NOT NULL,sha256 text NOT NULL,
        image bytea NOT NULL CHECK(octet_length(image)<=2097152),width integer NOT NULL,height integer NOT NULL,
        match_kind text NOT NULL CHECK(match_kind IN ('exact','family_only','unconfirmed')),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(store_id,proposal_id) REFERENCES catalog_proposals(store_id,id),
        UNIQUE(store_id,proposal_id,sha256)
      );
      INSERT INTO schema_migrations(version) VALUES(29);
    `);}
    const v30=await client.query('SELECT version FROM schema_migrations WHERE version=30');
    if(!v30.rowCount){await client.query(`
      CREATE TABLE payment_quotes (
        id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),request_id uuid NOT NULL REFERENCES order_requests(id),
        amount_paise integer NOT NULL CHECK(amount_paise>0),currency text NOT NULL CHECK(currency='INR'),
        original_total_paise bigint NOT NULL,lines jsonb NOT NULL,reason text NOT NULL,input_hash text NOT NULL,
        state text NOT NULL CHECK(state IN ('offered','accepted','superseded','expired')),
        consent_message_id uuid UNIQUE REFERENCES messages(id),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE payment_attempts (
        id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),quote_id uuid NOT NULL REFERENCES payment_quotes(id),request_id uuid NOT NULL REFERENCES order_requests(id),
        provider text NOT NULL,account_id text NOT NULL,amount_paise integer NOT NULL CHECK(amount_paise>0),currency text NOT NULL CHECK(currency='INR'),
        state text NOT NULL CHECK(state IN ('creating','pending','paid','failed','expired','cancelled','unknown','refund_pending','refunded','conflicting')),
        provider_link_id text,checkout_url text,payment_id text,refund_id text,cancel_requested boolean NOT NULL DEFAULT false,
        expires_at timestamptz NOT NULL,last_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(provider,account_id,provider_link_id)
      );
      CREATE UNIQUE INDEX payment_attempts_one_open ON payment_attempts(quote_id) WHERE state IN ('creating','pending','unknown','paid','refund_pending','refunded','conflicting');
      CREATE TABLE payment_events (
        provider text NOT NULL,account_id text NOT NULL,event_id text NOT NULL,store_id uuid NOT NULL REFERENCES stores(id),attempt_id uuid NOT NULL REFERENCES payment_attempts(id),
        payload_hash text NOT NULL,fact jsonb NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(provider,account_id,event_id)
      );
      INSERT INTO schema_migrations(version) VALUES(30);
    `);}
    const v31=await client.query('SELECT version FROM schema_migrations WHERE version=31');
    if(!v31.rowCount){await client.query(`
      ALTER TABLE stores ADD COLUMN inventory_policy text NOT NULL DEFAULT 'manual_confirm' CHECK(inventory_policy='manual_confirm');
      CREATE TABLE runtime_releases(artifact_hash text PRIMARY KEY CHECK(artifact_hash ~ '^[a-f0-9]{64}$'),metadata jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE messages ADD COLUMN release_fingerprint text REFERENCES runtime_releases(artifact_hash);
      INSERT INTO schema_migrations(version) VALUES(31);
    `);}
    const v32=await client.query('SELECT version FROM schema_migrations WHERE version=32');
    if(!v32.rowCount){await client.query(`
      ALTER TABLE conversations ADD COLUMN partial_reviews boolean NOT NULL DEFAULT false;
      ALTER TABLE conversations ADD COLUMN welcome_audio_queued boolean NOT NULL DEFAULT false;
      ALTER TABLE messages ADD COLUMN reply_decision text;
      ALTER TABLE order_requests ADD COLUMN estimate_complete boolean NOT NULL DEFAULT true;
      ALTER TABLE order_requests ADD COLUMN excluded_line_ids jsonb NOT NULL DEFAULT '[]';
      ALTER TABLE order_requests ADD COLUMN advance_required boolean NOT NULL DEFAULT false;
      ALTER TABLE order_requests ADD COLUMN effective_revision integer NOT NULL DEFAULT 1 CHECK(effective_revision>0);
      ALTER TABLE order_requests ADD COLUMN effective_lines jsonb;
      ALTER TABLE order_requests ADD COLUMN effective_total_paise bigint;
      CREATE TABLE order_advances (
        id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),request_id uuid NOT NULL UNIQUE REFERENCES order_requests(id),
        amount_paise integer NOT NULL CHECK(amount_paise=1000),currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
        payee_vpa text NOT NULL,payee_name text NOT NULL,upi_uri text NOT NULL,review_id uuid NOT NULL,
        state text NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','claimed','verified','refund_pending','refunded')),
        transaction_reference text,verified_by text,verified_at timestamptz,claimed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK(state NOT IN ('verified','refund_pending','refunded') OR (transaction_reference IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL))
      );
      CREATE UNIQUE INDEX order_advances_bank_reference ON order_advances(transaction_reference) WHERE transaction_reference IS NOT NULL;
      CREATE TABLE order_amendments (
        id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),request_id uuid NOT NULL REFERENCES order_requests(id),
        conversation_id uuid NOT NULL REFERENCES conversations(id),source_message_id uuid NOT NULL UNIQUE REFERENCES messages(id),
        source_version integer NOT NULL,expected_revision integer NOT NULL,
        kind text NOT NULL DEFAULT 'change' CHECK(kind IN ('change','cancel')),
        operations jsonb NOT NULL,proposed_lines jsonb NOT NULL,known_subtotal_paise bigint NOT NULL CHECK(known_subtotal_paise>=0),
        estimate_complete boolean NOT NULL,summary text NOT NULL,
        state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','owner_pending','accepted','rejected','withdrawn','superseded')),
        customer_message_id uuid REFERENCES messages(id),decided_by text,decided_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX order_amendments_one_pending ON order_amendments(request_id) WHERE state IN ('proposed','owner_pending');
      ALTER TABLE order_advances ADD COLUMN refund_reference text;
      CREATE TABLE order_quotes (
        id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),request_id uuid NOT NULL REFERENCES order_requests(id),
        amendment_id uuid REFERENCES order_amendments(id),expected_revision integer NOT NULL,lines jsonb NOT NULL,total_paise bigint NOT NULL CHECK(total_paise>=0),input_hash text NOT NULL,actor text NOT NULL,
        state text NOT NULL DEFAULT 'offered' CHECK(state IN ('offered','accepted','superseded')),
        consent_message_id uuid REFERENCES messages(id),created_at timestamptz NOT NULL DEFAULT now(),accepted_at timestamptz
      );
      CREATE UNIQUE INDEX order_quotes_one_offered ON order_quotes(request_id) WHERE state='offered';
      INSERT INTO schema_migrations(version) VALUES(32);
    `);}
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

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
    const v33=await client.query('SELECT version FROM schema_migrations WHERE version=33');
    if(!v33.rowCount){await client.query(`
      ALTER TABLE whatsapp_media ADD COLUMN original_audio bytea CHECK(original_audio IS NULL OR octet_length(original_audio) BETWEEN 1 AND 1048576);
      ALTER TABLE whatsapp_media ADD COLUMN original_mime_type text CHECK(original_mime_type IS NULL OR original_mime_type IN ('audio/webm','audio/ogg','audio/mp4','audio/wav','audio/mpeg'));
      ALTER TABLE whatsapp_media ADD COLUMN downloaded_at timestamptz;
      ALTER TABLE whatsapp_media ADD CONSTRAINT whatsapp_media_original_pair CHECK((original_audio IS NULL)=(original_mime_type IS NULL));
      INSERT INTO schema_migrations(version) VALUES(33);
    `);}
    const v34=await client.query('SELECT version FROM schema_migrations WHERE version=34');
    if(!v34.rowCount){await client.query(`
      ALTER TABLE order_advances DROP CONSTRAINT order_advances_state_check;
      ALTER TABLE order_advances ADD CONSTRAINT order_advances_state_check CHECK(state IN ('requested','claimed','verified','refund_pending','refunded','pay_at_shop'));
      ALTER TABLE order_advances ADD COLUMN demo_pay_at_shop_allowed boolean NOT NULL DEFAULT false;
      ALTER TABLE order_advances ADD COLUMN offered_at timestamptz;
      INSERT INTO schema_migrations(version) VALUES(34);
    `);}
    const v35=await client.query('SELECT version FROM schema_migrations WHERE version=35');
    if(!v35.rowCount){await client.query(`
      ALTER TABLE products ALTER COLUMN stock TYPE numeric(14,3);
      ALTER TABLE stores DROP CONSTRAINT stores_inventory_policy_check;
      ALTER TABLE stores ALTER COLUMN inventory_policy SET DEFAULT 'reserve_on_accept';
      UPDATE stores SET inventory_policy='reserve_on_accept';
      ALTER TABLE stores ADD CHECK(inventory_policy='reserve_on_accept');
      ALTER TABLE products ADD COLUMN reserved_stock numeric(14,3) NOT NULL DEFAULT 0 CHECK(reserved_stock>=0);
      ALTER TABLE products ADD COLUMN inventory_version integer NOT NULL DEFAULT 1;
      ALTER TABLE products ADD CONSTRAINT products_inventory_available CHECK((stock IS NULL AND reserved_stock=0) OR (stock IS NOT NULL AND stock>=reserved_stock));
      ALTER TABLE order_requests ADD COLUMN inventory_state text NOT NULL DEFAULT 'legacy' CHECK(inventory_state IN ('legacy','pending','reserved','untracked','consumed','released'));
      ALTER TABLE order_requests ALTER COLUMN inventory_state SET DEFAULT 'pending';
      ALTER TABLE order_requests ADD COLUMN packed_revision integer;
      ALTER TABLE order_requests ADD COLUMN inventory_untracked_line_ids jsonb NOT NULL DEFAULT '[]';
      CREATE TABLE inventory_reservations (
        store_id uuid NOT NULL,request_id uuid NOT NULL REFERENCES order_requests(id),sku text NOT NULL,
        quantity numeric(14,3) NOT NULL CHECK(quantity>0),revision integer NOT NULL,
        state text NOT NULL CHECK(state IN ('active','consumed','released')),
        created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(store_id,request_id,sku),FOREIGN KEY(store_id,sku) REFERENCES products(store_id,sku)
      );
      CREATE TABLE inventory_movements (
        id uuid PRIMARY KEY,store_id uuid NOT NULL,sku text NOT NULL,request_id uuid REFERENCES order_requests(id),
        operation_key text NOT NULL,input_hash text NOT NULL,kind text NOT NULL CHECK(kind IN ('opening','reserve','release','collect','restock','sale','count')),
        on_hand_before numeric(14,3),on_hand_after numeric(14,3),reserved_before numeric(14,3) NOT NULL,reserved_after numeric(14,3) NOT NULL,
        actor text NOT NULL,reason text NOT NULL,inventory_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(store_id,operation_key),FOREIGN KEY(store_id,sku) REFERENCES products(store_id,sku)
      );
      CREATE INDEX inventory_reservations_active ON inventory_reservations(store_id,sku) WHERE state='active';
      INSERT INTO schema_migrations(version) VALUES(35);
    `);}
    const v36=await client.query('SELECT version FROM schema_migrations WHERE version=36');
    if(!v36.rowCount){await client.query(`
      CREATE TABLE catalog_intake_batches (
        store_id uuid NOT NULL REFERENCES stores(id),batch_id text NOT NULL CHECK(length(batch_id) BETWEEN 1 AND 100),
        source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
        created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(store_id,batch_id)
      );
      CREATE TABLE catalog_intake_items (
        store_id uuid NOT NULL,batch_id text NOT NULL,source_sku text NOT NULL CHECK(length(source_sku) BETWEEN 1 AND 100),
        canonical_sku text CHECK(canonical_sku IS NULL OR length(canonical_sku) BETWEEN 1 AND 64),
        input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
        state text NOT NULL CHECK(state IN ('pending','staged','failed','excluded','conflict')),
        proposal_id uuid REFERENCES catalog_proposals(id),proposal_version integer CHECK(proposal_version IS NULL OR proposal_version>0),error text,
        updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,batch_id,source_sku),
        FOREIGN KEY(store_id,batch_id) REFERENCES catalog_intake_batches(store_id,batch_id)
      );
      CREATE INDEX catalog_intake_items_state ON catalog_intake_items(store_id,batch_id,state,source_sku);
      CREATE INDEX catalog_proposals_canonical_pending ON catalog_proposals(store_id,(details->>'sku')) WHERE state='draft';
      CREATE INDEX products_owner_name ON products(store_id,name,sku);
      CREATE INDEX products_owner_brand_name ON products(store_id,brand,name,sku);
      CREATE INDEX products_owner_family_name ON products(store_id,family_id,name,sku);
      CREATE INDEX products_owner_updated ON products(store_id,(coalesce(inventory_updated_at,'epoch'::timestamptz)) DESC,sku);
      CREATE INDEX catalog_proposals_owner_state ON catalog_proposals(store_id,state,created_at,id);
      CREATE INDEX messages_unfinished_conversation_sequence ON messages(conversation_id,sequence) WHERE status IN ('pending','processing');
      CREATE INDEX messages_conversation_sequence ON messages(conversation_id,sequence);
      ALTER TABLE catalog_photos ADD COLUMN content_hash text CHECK(content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$');
      CREATE INDEX catalog_photos_content ON catalog_photos(store_id,content_hash) WHERE content_hash IS NOT NULL;
      INSERT INTO schema_migrations(version) VALUES(36);
    `);}
    const v37=await client.query('SELECT version FROM schema_migrations WHERE version=37');
    if(!v37.rowCount){await client.query(`
      ALTER TABLE products ADD COLUMN indicative_price jsonb;
      ALTER TABLE products ADD CONSTRAINT products_indicative_price_check CHECK(indicative_price IS NULL OR coalesce(CASE WHEN
        jsonb_typeof(indicative_price)='object'
        AND indicative_price ?& ARRAY['pricePaise','lowPaise','highPaise','unit','currency','asOf','source','generation']
        AND jsonb_typeof(indicative_price->'pricePaise')='number'
        AND jsonb_typeof(indicative_price->'lowPaise')='number'
        AND jsonb_typeof(indicative_price->'highPaise')='number'
        AND jsonb_typeof(indicative_price->'generation')='object'
      THEN (indicative_price->>'pricePaise')::numeric BETWEEN 1 AND 2147483647
        AND (indicative_price->>'lowPaise')::numeric BETWEEN 1 AND (indicative_price->>'pricePaise')::numeric
        AND (indicative_price->>'highPaise')::numeric BETWEEN (indicative_price->>'pricePaise')::numeric AND 2147483647
        AND trunc((indicative_price->>'pricePaise')::numeric)=(indicative_price->>'pricePaise')::numeric
        AND trunc((indicative_price->>'lowPaise')::numeric)=(indicative_price->>'lowPaise')::numeric
        AND trunc((indicative_price->>'highPaise')::numeric)=(indicative_price->>'highPaise')::numeric
        AND indicative_price->>'unit' IN ('piece','box','pack','pair','roll','bottle','can','tin','bucket','metre','foot','kg','litre')
        AND indicative_price->>'currency'='INR'
        AND indicative_price->>'source'='model-low-indicative'
        AND indicative_price->>'asOf' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND indicative_price->'generation' ?& ARRAY['model','effort','inputHash','proposalHash']
        AND length(indicative_price->'generation'->>'model') BETWEEN 1 AND 100
        AND indicative_price->'generation'->>'effort'='low'
        AND indicative_price->'generation'->>'inputHash' ~ '^[a-f0-9]{64}$'
        AND indicative_price->'generation'->>'proposalHash' ~ '^[a-f0-9]{64}$'
      ELSE false END,false));
      CREATE FUNCTION clear_stale_indicative_price() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.name IS DISTINCT FROM OLD.name OR NEW.unit IS DISTINCT FROM OLD.unit
          OR NEW.brand IS DISTINCT FROM OLD.brand OR NEW.specifications IS DISTINCT FROM OLD.specifications
          OR NEW.selling_policy IS DISTINCT FROM OLD.selling_policy OR NEW.quantity_step IS DISTINCT FROM OLD.quantity_step
          OR NEW.price_paise IS DISTINCT FROM OLD.price_paise OR NEW.price_status IS DISTINCT FROM OLD.price_status
        THEN NEW.indicative_price=NULL; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER products_clear_indicative_price BEFORE UPDATE ON products
        FOR EACH ROW WHEN (OLD.indicative_price IS NOT NULL) EXECUTE FUNCTION clear_stale_indicative_price();
      INSERT INTO schema_migrations(version) VALUES(37);
    `);}
    const v38=await client.query('SELECT version FROM schema_migrations WHERE version=38');
    if(!v38.rowCount){await client.query(`
      CREATE TABLE catalog_fact_batches (
        id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),
        file_hash text NOT NULL CHECK(file_hash ~ '^[a-f0-9]{64}$'),filename text,
        expires_at timestamptz NOT NULL,status text NOT NULL CHECK(status IN ('preview','invalid','applying','complete','blocked')),
        rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 3000),
        chunks jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(chunks)='array'),
        next_row integer NOT NULL DEFAULT 0 CHECK(next_row BETWEEN 0 AND 3000),error text,
        created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX catalog_fact_batches_store_created ON catalog_fact_batches(store_id,created_at DESC,id);
      INSERT INTO schema_migrations(version) VALUES(38);
    `);}
    const v39=await client.query('SELECT version FROM schema_migrations WHERE version=39');
    if(!v39.rowCount){await client.query(`
      ALTER TABLE catalog_proposal_assets ADD COLUMN image_hash text CHECK(image_hash IS NULL OR image_hash ~ '^[a-f0-9]{64}$');
      CREATE TABLE catalog_image_variants (
        store_id uuid NOT NULL REFERENCES stores(id),source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
        max_side integer NOT NULL CHECK(max_side IN (128,256,640)),
        image bytea NOT NULL CHECK(octet_length(image) BETWEEN 1 AND 2097152),
        content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(store_id,source_hash,max_side)
      );
      INSERT INTO schema_migrations(version) VALUES(39);
    `);}
    const v40=await client.query('SELECT version FROM schema_migrations WHERE version=40');
    if(!v40.rowCount){await client.query(`
      CREATE TABLE order_quote_drafts (
        request_id uuid PRIMARY KEY REFERENCES order_requests(id) ON DELETE CASCADE,
        store_id uuid NOT NULL REFERENCES stores(id),expected_revision integer NOT NULL CHECK(expected_revision>0),
        amendment_id uuid REFERENCES order_amendments(id) ON DELETE CASCADE,
        lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 50),
        version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_by text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO schema_migrations(version) VALUES(40);
    `);}
    const v41=await client.query('SELECT version FROM schema_migrations WHERE version=41');
    if(!v41.rowCount){await client.query(`
      ALTER TABLE voice_media DROP CONSTRAINT voice_media_audio_check;
      ALTER TABLE voice_media ADD CONSTRAINT voice_media_audio_check CHECK(octet_length(audio)<=2880044);
      ALTER TABLE voice_media DROP CONSTRAINT voice_media_duration_seconds_check;
      ALTER TABLE voice_media ADD CONSTRAINT voice_media_duration_seconds_check CHECK(duration_seconds>0 AND duration_seconds<=90);
      ALTER TABLE whatsapp_media DROP CONSTRAINT whatsapp_media_original_audio_check;
      ALTER TABLE whatsapp_media ADD CONSTRAINT whatsapp_media_original_audio_check CHECK(original_audio IS NULL OR octet_length(original_audio) BETWEEN 1 AND 4194304);
      INSERT INTO schema_migrations(version) VALUES(41);
    `);}
    const v42=await client.query('SELECT version FROM schema_migrations WHERE version=42');
    if(!v42.rowCount){await client.query(`
      ALTER TABLE whatsapp_conversations
        ADD COLUMN profile_name text CHECK(profile_name IS NULL OR length(profile_name) BETWEEN 1 AND 200),
        ADD COLUMN profile_updated_at timestamptz;
      INSERT INTO schema_migrations(version) VALUES(42);
    `);}
    const v43=await client.query('SELECT version FROM schema_migrations WHERE version=43');
    if(!v43.rowCount){await client.query(`
      ALTER TABLE order_advances DROP CONSTRAINT IF EXISTS order_advances_check;
      ALTER TABLE order_advances ADD CONSTRAINT order_advances_verified_owner_check
        CHECK(state NOT IN ('verified','refund_pending','refunded') OR (verified_by IS NOT NULL AND verified_at IS NOT NULL));
      CREATE TABLE owner_order_reviews (
        id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),request_id uuid NOT NULL REFERENCES order_requests(id),
        input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
        result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX owner_order_reviews_request ON owner_order_reviews(store_id,request_id,created_at DESC);
      INSERT INTO schema_migrations(version) VALUES(43);
    `);}
    const v44=await client.query('SELECT version FROM schema_migrations WHERE version=44');
    if(!v44.rowCount){await client.query(`
      ALTER TABLE products ADD COLUMN product_group_id uuid,ADD COLUMN product_group_name text,
        ADD COLUMN variant_label text;
      ALTER TABLE products ADD CONSTRAINT product_variant_identity CHECK(
        (product_group_id IS NULL AND product_group_name IS NULL AND variant_label IS NULL) OR
        (product_group_id IS NOT NULL AND product_group_name IS NOT NULL AND variant_label IS NOT NULL AND length(product_group_name) BETWEEN 2 AND 100 AND length(variant_label) BETWEEN 1 AND 55));
      CREATE UNIQUE INDEX products_group_variant ON products(store_id,product_group_id,lower(regexp_replace(variant_label,'[[:space:]·]+','','g'))) WHERE product_group_id IS NOT NULL;
      CREATE TABLE product_variant_batches(store_id uuid NOT NULL REFERENCES stores(id),id uuid NOT NULL,
        input_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,id));
      INSERT INTO schema_migrations(version) VALUES(44);
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

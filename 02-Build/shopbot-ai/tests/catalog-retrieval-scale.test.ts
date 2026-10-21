import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import type {SimulatorEvent,Snapshot} from '../packages/contracts/index.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {discoverProducts,getCatalogMap,refinementPlan} from '../apps/server/src/services/catalog-discovery.js';
import {catalogMeasurements,measurementSpecEqual,catalogMeasurementSqlPattern} from '../packages/contracts/catalog-measurements.js';
import {discoveryMoreValue} from '../packages/contracts/discovery.js';
import type {ActorContext} from '../apps/server/src/services/context.js';

async function fixture(run:(c:pg.PoolClient,ctx:ActorContext,pool:pg.Pool)=>Promise<void>){
 assert.ok(process.env.DATABASE_URL,'Set an isolated DATABASE_URL explicitly');
 const schema='retrieval_scale_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');const storeId=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Retrieval scale test',true)",[storeId]);await pool.query("INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,'hardware')",[storeId]);await pool.query("INSERT INTO catalog_nodes(store_id,id,kind,label) VALUES($1,'surfaces','department','Surfaces')",[storeId]);await pool.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases) VALUES($1,'paint','surfaces','family','Wall paint','[\"paint\"]')",[storeId]);const c=await pool.connect();try{await run(c,{storeId,conversationId:randomUUID(),actor:'retrieval-scale-test',role:'customer'},pool);}finally{c.release();}}
 finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}

test('typed measurements preserve fractions and physical units without amount conversions',()=>{
 assert.deepEqual(catalogMeasurements('1/2 inch fitting 4 litres 4 kg'),[{value:.5,unit:'inch'},{value:4,unit:'litre'},{value:4,unit:'kg'}]);
 assert.equal(measurementSpecEqual('½ inch','0.5 inches'),true);
 assert.equal(measurementSpecEqual('4L','4 kg'),false);
 assert.equal(measurementSpecEqual('1 litre','1000 ml'),false);
 assert.match(catalogMeasurementSqlPattern({value:.5,unit:'inch'}),/½/);
});

test('typed eligibility runs before the 120 candidate cap and cannot take units from aliases',()=>fixture(async(c,ctx)=>{
 await c.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,family_id,specifications,aliases)
 SELECT $1,'A-'||lpad(n::text,4,'0'),'Apex Wall Paint 4 kg variant '||n,'bucket',0,'paint','{"size":"4 kg"}','["Apex paint 4L"]' FROM generate_series(1,2999) n`,[ctx.storeId]);
 await c.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,family_id,specifications,aliases) VALUES($1,'Z-LITRE','Apex White Wall Paint 4 L','can',0,'paint','{"size":"4 L"}','["Apex paint"]')`,[ctx.storeId]);
 const r=await discoverProducts(c,ctx,'Apex paint 4 litres');assert.deepEqual(r.products.map(p=>p.sku),['Z-LITRE']);assert.equal(r.diagnostics?.sqlMatchCount,1);assert.deepEqual(r.diagnostics?.appliedConstraints.measurements,[{value:4,unit:'litre'}]);
 await c.query("INSERT INTO products(store_id,sku,name,unit,price_paise,family_id,specifications) VALUES($1,'SPLIT-FACT','Apex White Wall Paint 4','can',0,'paint','{\"size\":\"kg\"}')",[ctx.storeId]);
 const split=await discoverProducts(c,ctx,'Apex paint 4 kg');assert.ok(!split.products.some(p=>p.sku==='SPLIT-FACT'),'separate fields cannot fabricate a numeric measurement');
 const conflict=await discoverProducts(c,ctx,'Apex paint 4 litres',{keywords:['Apex paint'],specifications:{size:'4 kg'}});assert.deepEqual(conflict.products,[]);
 const wrong=await discoverProducts(c,ctx,'Apex paint 40 litres');assert.deepEqual(wrong.products,[]);
}));

test('a rare requested identity survives more than 120 rejected lexical candidates',()=>fixture(async(c,ctx)=>{
 await c.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,family_id) SELECT $1,'A-'||lpad(n::text,4,'0'),'Ordinary wall paint variant '||n,'can',0,'paint' FROM generate_series(1,300) n`,[ctx.storeId]);
 await c.query("INSERT INTO products(store_id,sku,name,unit,price_paise,family_id) VALUES($1,'Z-COBALT','Specialty cobalt exterior wall paint','can',0,'paint')",[ctx.storeId]);
 const r=await discoverProducts(c,ctx,'Specialty cobalt paint',{keywords:['paint']});assert.deepEqual(r.products.map(p=>p.sku),['Z-COBALT']);assert.equal(r.diagnostics?.scannedCount,301);assert.equal(r.diagnostics?.rejectedCount,300);assert.equal(r.diagnostics?.candidateLimited,false);
}));

test('facet pages expose late brands and independent specification keys beyond the old global facet cap',()=>fixture(async(c,ctx)=>{
 await c.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,family_id,brand,specifications) SELECT $1,'P-'||lpad(n::text,4,'0'),'Wall paint model '||n,'can',0,'paint','Brand '||lpad(n::text,3,'0'),jsonb_build_object('colour','Colour '||n,'finish','Finish '||n) FROM generate_series(1,180) n`,[ctx.storeId]);
 let r=await discoverProducts(c,ctx,'paint');const visited:string[]=[];
 for(let page=0;page<90;page++){
  const facet=r.facets.find(f=>f.key==='brand')!;assert.equal(facet.totalValues,180);assert.ok(facet.values.length<=3);visited.push(...facet.values.map(v=>v.value));
  assert.ok(r.facets.some(f=>f.key==='spec:colour'));assert.ok(r.facets.some(f=>f.key==='spec:finish'));
  if(facet.nextOffset===undefined)break;
  const first={...r,facets:[facet,...r.facets.filter(f=>f!==facet)]};r=await discoverProducts(c,ctx,'paint',refinementPlan(first,'brand',discoveryMoreValue));
 }
 assert.equal(new Set(visited).size,180);assert.ok(visited.includes('Brand 180'));
 const filtered=await discoverProducts(c,ctx,'paint',{keywords:['paint'],facetPage:{key:'brand',offset:0,search:'180'}});assert.equal(filtered.facets[0]?.values[0]?.value,'Brand 180');
 const narrow=await discoverProducts(c,ctx,'paint',{keywords:['paint'],brand:'Brand 180'});assert.deepEqual(narrow.products.map(p=>p.sku),['P-0180']);
 assert.throws(()=>refinementPlan(narrow,'brand',discoveryMoreValue),/not offered/);
 await c.query("UPDATE products SET specifications=specifications||(SELECT jsonb_object_agg('zz_extra'||i,sku) FROM generate_series(1,20) i) WHERE store_id=$1 AND sku IN ('P-0001','P-0002')",[ctx.storeId]);
 const bounded=await discoverProducts(c,ctx,'paint');assert.ok(bounded.facets.length<=12);assert.ok(bounded.diagnostics?.uncertainty.includes('facet_key_limit'));
 const keyPage=await discoverProducts(c,ctx,'paint',{keywords:['paint'],facetPage:{key:'spec:zz_extra20',offset:0}});assert.equal(keyPage.facets[0]?.key,'spec:zz_extra20');
}));

test('taxonomy pages keep accurate department counts and make families beyond 30 and departments beyond 20 reachable',()=>fixture(async(c,ctx)=>{
 await c.query(`INSERT INTO catalog_nodes(store_id,id,kind,label) SELECT $1,'dept-'||lpad(n::text,2,'0'),'department','Department '||n FROM generate_series(1,25) n`,[ctx.storeId]);
 await c.query(`INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label) SELECT $1,'type-'||lpad(n::text,2,'0'),'surfaces','family','Type '||n FROM generate_series(1,35) n`,[ctx.storeId]);
 await c.query("INSERT INTO products(store_id,sku,name,unit,price_paise,family_id) VALUES($1,'LATE','Late type paint','piece',0,'type-35')",[ctx.storeId]);
 const first=await getCatalogMap(c,ctx);assert.equal(first.departments.length,20);assert.ok(first.nextDepartmentAfter);const next=await getCatalogMap(c,ctx,undefined,{departmentAfter:first.nextDepartmentAfter});assert.ok(next.departments.some(d=>d.id==='surfaces'));
 const family=await getCatalogMap(c,ctx,'surfaces');assert.equal(family.departments[0].count,1);assert.equal(family.departments[0].families.length,30);assert.ok(family.nextFamilyAfter);
 const rest=await getCatalogMap(c,ctx,'surfaces',{familyAfter:family.nextFamilyAfter});assert.ok(rest.departments[0].families.some(f=>f.id==='type-35'));assert.equal(rest.departments[0].count,1);
 const search=await getCatalogMap(c,ctx,undefined,{search:'Type 35'});assert.deepEqual(search.departments[0]?.families.map(f=>f.id),['type-35']);
}));


test('More choices traverses a bound current question with three native buttons and rejects replay',()=>fixture(async(c,ctx,pool)=>{
 await c.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,family_id,brand) SELECT $1,'P-'||n,'Wall paint model '||n,'can',0,'paint','Brand '||n FROM generate_series(1,7) n`,[ctx.storeId]);
 await c.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[ctx.conversationId,ctx.storeId,ctx.actor]);
 const inbox=new SimulatorService(pool,ctx),runtime=new ConversationRuntime(pool,{name:'no-model-for-pages',mode:'mock',interpret:async()=>{throw new Error('Page action must not call a model');}});
 const send=async(event:SimulatorEvent)=>{await inbox.ingest(event);await runtime.processNext(ctx);return inbox.snapshot();};
 const last=(s:Snapshot)=>s.messages.at(-1)!.rich!;
 let state=await send({id:randomUUID(),type:'browse',query:'paint',expectedVersion:0});
 const first=last(state),more=first.buttons!.find(b=>b.event.type==='refine_discovery'&&b.event.value===discoveryMoreValue)!;assert.ok(more);assert.equal(first.buttons!.length,3);
 const before=first.buttons!.filter(b=>b!==more).map(b=>b.label);
 state=await send(more.event);assert.ok(last(state).buttons!.some(b=>!before.includes(b.label)&&b.event.type==='refine_discovery'&&b.event.value!==discoveryMoreValue));
 assert.equal(state.conversation.draft.length,0);assert.equal(state.interpretationAttempts,0);
 state=await send({...more.event,id:randomUUID()});assert.match(last(state).text,/no longer current/);assert.equal(state.requests.length,0);
}));


test('eligible preferred late variants survive the cap while exact identity keeps first place',()=>fixture(async(c,ctx)=>{
 await c.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,family_id,aliases) SELECT $1,'P-'||lpad(n::text,4,'0'),'Wall paint model '||n,'can',0,'paint','["Wall paint model 1"]' FROM generate_series(1,300) n`,[ctx.storeId]);
 const late=await discoverProducts(c,ctx,'paint',{keywords:['paint'],preferredSkus:['P-0300']});assert.equal(late.products[0]?.sku,'P-0300');
 const exact=await discoverProducts(c,ctx,'Wall paint model 1',{keywords:['paint'],preferredSkus:['P-0300']});assert.equal(exact.products[0]?.sku,'P-0001');
 const conflict=await discoverProducts(c,ctx,'paint',{keywords:['paint'],preferredSkus:['P-0300'],brand:'Not sold here'});assert.deepEqual(conflict.products,[]);
}));

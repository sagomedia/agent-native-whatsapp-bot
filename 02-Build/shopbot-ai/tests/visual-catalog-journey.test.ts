import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {discoverProducts,refinementPlan} from '../apps/server/src/services/catalog-discovery.js';
import {discoveryPresentation} from '../apps/server/src/services/discovery-replies.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';
import type {Snapshot,SimulatorEvent,RichReply} from '../packages/contracts/index.js';

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService,runtime:ConversationRuntime,calls:()=>number)=>Promise<void>,extras=false){
 const schema='visual_catalog_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const storeId=randomUUID(),conversationId=randomUUID(),actor='visual-catalog-test';
  await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Synthetic photo shop',true)",[storeId]);
  await pool.query("INSERT INTO store_policies(store_id,require_product_confirmation) VALUES($1,true)",[storeId]);
  await pool.query("INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,'hardware')",[storeId]);
  await pool.query("INSERT INTO catalog_nodes(store_id,id,kind,label) VALUES($1,'hardware','department','Hardware')",[storeId]);
  for(const [id,label] of [['solvent-cements','PVC solvent cements'],['paint-thinners','Paint thinners']])await pool.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases) VALUES($1,$2,'hardware','family',$3,$4)",[storeId,id,label,JSON.stringify([label,'solvent'])]);
  for(let n=1;n<=19;n++)await pool.query("INSERT INTO products(store_id,sku,name,family_id,brand,aliases,unit,price_paise,stock,selling_unit_verified,image_path) VALUES($1,$2,$3,'solvent-cements',$4,'[\"PVC solvent cement\"]','can',16000,30,true,'/demo-images/H07.jpg')",[storeId,'C'+n.toString().padStart(2,'0'),`PVC solvent cement ${n} 100ml`,n<=10?'Brand A':'Brand B']);
  await pool.query("INSERT INTO products(store_id,sku,name,family_id,brand,aliases,unit,price_paise,stock,selling_unit_verified,image_path) VALUES($1,'THINNER','Paint thinner','paint-thinners','Paint Brand','[\"solvent\"]','can',9000,30,true,NULL)",[storeId]);
  await pool.query("INSERT INTO conversations(id,store_id,actor,visual_ordering,reply_language,reply_language_explicit) VALUES($1,$2,$3,true,'en',true)",[conversationId,storeId,actor]);
  let calls=0;
  const runtime=new ConversationRuntime(pool,{name:'offline-visual-catalog',mode:'mock',interpret:async()=>{calls++;return {output:{operations:[{kind:'add_item',query:'solvent',quantity:2},...(extras?[{kind:'add_item' as const,query:'C18',quantity:1},{kind:'add_item' as const,query:'C19',quantity:1}]:[])],next:'review'},usage:null,truncated:false};}},{visualOrdering:true});
  const inbox=new SimulatorService(pool,{storeId,conversationId,actor,role:'customer'});
  await run(pool,inbox,runtime,()=>calls);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
function capture(name:string,s:Snapshot,metrics?:Record<string,number>){const dir=process.env.CAROUSEL_EVIDENCE_DIR;if(!dir)return;mkdirSync(dir,{recursive:true});writeFileSync(join(dir,name+'.json'),JSON.stringify({rich:reply(s),draft:s.conversation.draft,metrics},null,2));}
const reply=(s:Snapshot):RichReply=>s.messages.filter(m=>m.direction==='outbound').at(-1)!.rich!;
const actions=(s:Snapshot)=>reply(s).parts?.flatMap(p=>p.cards.flatMap(c=>c.buttons??[]).concat(p.buttons??[])).map(b=>b.event)??[];
async function send(i:SimulatorService,r:ConversationRuntime,event:SimulatorEvent){await i.ingest(event);await r.processNext(i.context);return i.snapshot();}
function assertCarousel(s:Snapshot,count:number){const rich=reply(s);assert.equal(rich.parts?.[0].cards.length??rich.cards?.length,count);assert.equal(renderWhatsAppReply(rich,randomUUID(),'shop.example.test').format,'carousel');}

for(const extras of [false,true])test(`solvent and ${extras?'two additional products':'one product'} finish visually below fifteen turns with one interpretation`,()=>fixture(async(_pool,i,r,calls)=>{
 let turns=1,s=await send(i,r,{id:randomUUID(),type:'text',text:extras?'I need two solvent, C18 one and C19 one':'I need two solvent'});
 assert.equal(s.conversation.draft[0].sku,undefined);assert.equal(s.conversation.draft[0].quantity,2);assertCarousel(s,2);
 capture(`order-${extras?3:1}-categories`,s);
 const groups=reply(s).parts![0].cards;assert.ok(groups.every(c=>c.kind==='instruction'));assert.ok(groups.some(c=>c.caption.includes('PVC')));assert.ok(groups.some(c=>c.caption.includes('Paint thinners')));
 const use=actions(s).find(e=>e.type==='refine_search'&&e.value==='solvent-cements');assert.ok(use);
 s=await send(i,r,use!);turns++;capture(`order-${extras?3:1}-brands`,s);assertCarousel(s,2);assert.ok(reply(s).parts![0].cards.every(c=>c.caption.includes('Brand')));assert.equal(s.conversation.draft[0].quantity,2);
 const brand=actions(s).find(e=>e.type==='refine_search'&&e.value==='Brand A');assert.ok(brand);
 s=await send(i,r,brand!);turns++;capture(`order-${extras?3:1}-products`,s);assertCarousel(s,10);assert.ok(reply(s).parts![0].cards.every(c=>c.kind==='product'&&c.product.familyId==='solvent-cements'&&c.caption.includes('₹160.00')&&c.caption.includes('Requested: 2')));
 const select=actions(s).find(e=>e.type==='select_product');assert.ok(select);s=await send(i,r,select!);turns++;
 capture(`order-${extras?3:1}-review`,s);
 assert.equal(s.conversation.draft[0].quantity,2);assert.ok(s.conversation.draft[0].productConfirmation);assert.equal(s.requests.length,0);
 for(let n=0;n<4&&!s.requests.length;n++){
  const next=actions(s).find(e=>e.type==='confirm_products'||e.type==='review'||e.type==='confirm');assert.ok(next,JSON.stringify(reply(s)));
  s=await send(i,r,next!);turns++;
 }
 capture(`order-${extras?3:1}-submitted`,s,{customerTurns:turns,interpretations:calls(),orders:s.requests.length});
 assert.equal(s.requests.length,1);assert.ok(turns<15);assert.equal(calls(),1);
 assert.equal(s.requests[0].lines.length,extras?3:1);assert.notEqual(s.requests[0].lines[0].sku,'THINNER');
 assert.equal(s.requests[0].lines[0].quantity,2);
},extras));

test('browse and brand taps use only saved catalog scope and reject stale groups',()=>fixture(async(_pool,i,r,calls)=>{
 let s=await send(i,r,{id:randomUUID(),type:'browse',query:'solvent-cements',expectedVersion:0});
 assertCarousel(s,2);const old=actions(s).find(e=>e.type==='refine_discovery'&&e.value==='Brand A');assert.ok(old);
 s=await send(i,r,old!);assertCarousel(s,10);assert.equal(s.conversation.draft.length,0);assert.equal(calls(),0);
 s=await send(i,r,{...old!,id:randomUUID()});assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);assert.equal(calls(),0);assert.equal(reply(s).stage,'error');
}));


test('a 3000-product catalog keeps counts scoped and visual brand paging bounded',()=>fixture(async(pool,inbox,_runtime,calls)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,family_id,brand,aliases,unit,price_paise,stock,selling_unit_verified,image_path) SELECT $1,'SCALE-'||n,'PVC solvent cement scale '||n,'solvent-cements','Scale brand '||(n%5),'[\"PVC solvent cement\"]'::jsonb,'can',16000,30,true,'/demo-images/H07.jpg' FROM generate_series(1,3000) n",[inbox.context.storeId]);
 const c=await pool.connect();try{
  const found=await discoverProducts(c,inbox.context,'PVC solvent cements',{keywords:['PVC solvent cements'],familyId:'solvent-cements'});
  assert.equal(found.totalCount,3019);assert.ok(found.products.length<=10);
  const snap=await inbox.snapshot(),rich=discoveryPresentation(found,snap.conversation,randomUUID());
  assert.equal(rich.clarificationReason,'catalog_group');assert.ok(rich.parts![0].cards.length<=10);
  const brand=found.facets.find(f=>f.key==='brand')!;assert.ok(brand.nextOffset!==undefined);
  const next=await discoverProducts(c,inbox.context,found.query,refinementPlan(found,'brand','__more__'));
  assert.equal(next.totalCount,3019);assert.ok(next.products.length<=10);
  const page=discoveryPresentation(next,snap.conversation,randomUUID());assert.equal(page.clarificationReason,'catalog_group');
  assert.ok(page.parts![0].cards.every(card=>card.buttons?.every(b=>b.event.type==='refine_discovery'&&b.event.facet==='brand')));
  assert.equal(calls(),0);assert.equal(snap.conversation.draft.length,0);
 }finally{c.release();}
}));

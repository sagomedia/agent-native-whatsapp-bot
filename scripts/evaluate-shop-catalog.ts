/** Read-only catalog snapshot replay. No provider, WhatsApp or production DB access. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {discoverProducts} from '../apps/server/src/services/catalog-discovery.js';
import {discoveryPresentation} from '../apps/server/src/services/discovery-replies.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';

const connectionString=process.env.DATABASE_URL,uri=new URL(connectionString??'postgres://invalid');
if(!['localhost','127.0.0.1','[::1]'].includes(uri.hostname)||!uri.pathname.endsWith('_test'))throw new Error('Use a dedicated local database ending in _test.');
const [snapshotPath,reportPath]=process.argv.slice(2);if(!snapshotPath||!reportPath)throw new Error('Pass catalog snapshot JSON and report output paths.');
const snapshot: {nodes: Array<{id:string;parent_id:string|null;kind:string;label:string;aliases:string[];local_names:Record<string,string>}>;products:Array<Record<string,unknown>>}=JSON.parse(await readFile(snapshotPath,'utf8'));
const schema='shop_quality_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});
await admin.query('CREATE SCHEMA '+schema);
const pool=new pg.Pool({connectionString,options:'-c search_path='+schema});
try{
 await setupDatabase(pool,'mock');const storeId=randomUUID();
 await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Isolated shop catalog evaluation',true)",[storeId]);
 await pool.query("INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,'hardware')",[storeId]);
 for(const node of [...snapshot.nodes].sort((a,b)=>Number(!!a.parent_id)-Number(!!b.parent_id)))await pool.query('INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases,local_names) VALUES($1,$2,$3,$4,$5,$6,$7)',[storeId,node.id,node.parent_id,node.kind,node.label,JSON.stringify(node.aliases),JSON.stringify(node.local_names)]);
 const columns=(await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='products' AND is_generated='NEVER' ORDER BY ordinal_position",[schema])).rows;
 for(const product of snapshot.products){const fields=columns.filter(c=>Object.hasOwn(product,c.column_name));await pool.query('INSERT INTO products('+fields.map(f=>f.column_name).join(',')+') VALUES('+fields.map((_,i)=>'$'+(i+1)).join(',')+')',fields.map(f=>f.column_name==='store_id'?storeId:f.data_type==='jsonb'&&product[f.column_name]!==null?JSON.stringify(product[f.column_name]):product[f.column_name]));}
 const queries=['ரசமட்டம்','ரச மட்டம்','rasa mattam','rasamattam','rasa mattam venum','spirit level','spirit level 12 inch','spirit level 24 inch','உளி','uli','ஒலி','oli','nalli','nalli tap','tap','nipple','threaded nipple','solvent','paint thinner','PVC solvent cement','PVC pipe ottura solvent','aluminium door latch','door latch','stainless steel door latch 6 inch','aluminium door latch 6 inch','தாப்பா'];
 const cases:unknown[]=[],client=await pool.connect();
 try{for(const query of queries){
  const result=await discoverProducts(client,{storeId,conversationId:randomUUID(),actor:'isolated-evaluation',role:'customer'},query);
  const rich=discoveryPresentation(result,{version:0,draft:[],pending:null,fulfillment:'pickup',lastRequestId:null,replyLanguage:'ta',visualOrdering:true},randomUUID());
  const cards=rich.parts?.flatMap(p=>p.cards)??rich.cards?.map(c=>({kind:'product' as const,...c,caption:c.detailLabel??''}))??[];
  assert.ok(result.products.length<=10);assert.ok(!rich.parts?.some(p=>p.cards.length>10));
  if(query==='spirit level 12 inch')assert.ok(result.products.some(p=>p.sku==='CANON-KSMC-0037'&&p.imageUrl));
  if(query==='spirit level 24 inch')assert.equal(result.products.length,0);
  if(query==='ரசமட்டம்')assert.equal(result.products.length,3);
  if(query==='solvent'){assert.equal(result.matchStatus,'needs_detail');assert.ok(result.groups?.length);}
  cases.push({query,status:result.matchStatus,count:result.totalCount,products:result.products.map(p=>({sku:p.sku,name:p.name,photo:!!p.imageUrl,sellingUnitVerified:p.sellingUnitVerified,stock:p.stock})),groups:result.groups?.map(g=>({label:g.label,count:g.count})),presentation:{stage:rich.stage,text:rich.text,cards:cards.length,productCards:cards.filter(c=>c.kind==='product').length},diagnostics:result.diagnostics});
 }}finally{client.release();}
 const journeys:unknown[]=[];
 for(const [text,query] of [['ரச மட்டம் ஒன்று வேணும்','spirit level 12 inch'],['உளி வேணும்','உளி'],['solvent ஒன்று','solvent'],['அலுமினியம் டோர் தாப்பா ஒன்று','aluminium door latch']]){
  const conversationId=randomUUID(),actor='isolated-journey';await pool.query("INSERT INTO conversations(id,store_id,actor,visual_ordering,reply_language,reply_language_explicit) VALUES($1,$2,$3,true,'ta',true)",[conversationId,storeId,actor]);
  const inbox=new SimulatorService(pool,{storeId,conversationId,actor,role:'customer'});let calls=0;
  const runtime=new ConversationRuntime(pool,{name:'mock-canonical-understanding',mode:'mock',interpret:async()=>{calls++;return {output:{operations:[{kind:'add_item',query,quantity:1}],next:'review'},usage:null,truncated:false};}},{visualOrdering:true});
  await inbox.ingest({id:randomUUID(),type:'text',text});await runtime.processNext(inbox.context);const s=await inbox.snapshot(),rich=s.messages.at(-1)!.rich!;
  assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].quantity,1);assert.equal(s.requests.length,0);
  const cards=rich.parts?.flatMap(p=>p.cards)??rich.cards?.map(c=>({kind:'product' as const,...c,caption:c.detailLabel??''}))??[];if(query==='aluminium door latch'){assert.equal(rich.stage,'shop_check');assert.match(rich.text,/கடை சரிபார்க்க/);}else assert.ok(cards.length>0);
  journeys.push({text,mockedCanonicalQuery:query,interpretations:calls,orders:0,draftCount:1,stage:rich.stage,textShown:rich.text,presentation:rich.presentation,cards:cards.map(c=>({kind:c.kind,...(c.kind==='product'?{sku:c.product.sku,photo:!!c.product.imageUrl,caption:c.caption}:{title:c.title,caption:c.caption})}))});
 }
 await writeFile(reportPath,JSON.stringify({method:'Actual catalog copied into an isolated local schema; real SQL retrieval and conversation runtime; fixed mock canonical interpretation for journeys.',products:snapshot.products.length,queries:cases.length,cases,journeys,providerCalls:0,customerMessagesSent:0,productionWrites:0,limitations:['Does not measure fresh audio transcription or model interpretation accuracy.','Photo presence is metadata, not visual provenance or WhatsApp rendering verification.','Missing entries and ambiguous colloquial words need merchant evidence; no aliases or commercial facts were invented.']},null,2));
 console.log(JSON.stringify({passed:true,queries:cases.length,journeys:journeys.length,providerCalls:0,reportPath}));
}finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}

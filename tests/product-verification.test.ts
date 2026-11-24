import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import type {Operation,SimulatorEvent,Snapshot} from '../packages/contracts/index.js';

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const connectionString=process.env.DATABASE_URL,admin=new pg.Pool({connectionString}),schema='visual_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await pool.query('INSERT INTO store_policies VALUES($1,true)',[simulatorContext.storeId]);await pool.query("UPDATE products SET image_path='/demo-images/test.jpg' WHERE store_id=$1",[simulatorContext.storeId]);await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,image_path) VALUES($1,'SOLVENT','PVC Solvent Gum 100ml','bottle',8500,20,'/demo-images/solvent.jpg')",[simulatorContext.storeId]);await run(pool,new SimulatorService(pool));}
 finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
function planner(operations:Operation[],next='review'):Interpreter{return {name:'offline-visual-planner',mode:'mock',interpret:async()=>({output:{operations,next},truncated:false,usage:null})};}
async function event(inbox:SimulatorService,runtime:ConversationRuntime,e:SimulatorEvent){await inbox.ingest(e);await runtime.processNext(inbox.context);return inbox.snapshot();}
async function text(inbox:SimulatorService,runtime:ConversationRuntime,value:string){return event(inbox,runtime,{id:randomUUID(),type:'text',text:value});}
function last(s:Snapshot){return s.messages.at(-1)!.rich!;}
function choice(s:Snapshot,sku:string){return last(s).cards!.find(c=>c.product.sku===sku)!.action!;}

test('exact products show photos before acceptance; bottle quantities before and after selection never call AI',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'SOLVENT',quantity:null}],'continue'));
 let s=await text(inbox,runtime,'solvent solution i want');assert.equal(s.conversation.pending?.kind,'products');assert.equal(last(s).cards?.[0].product.imageUrl,'/demo-images/solvent.jpg');assert.equal(s.conversation.draft[0].productConfirmation,undefined);
 const early=choice(s,'SOLVENT');s=await text(inbox,runtime,'5 bottles');assert.equal(s.conversation.draft[0].quantity,5);assert.equal(s.conversation.pending?.kind,'products');assert.equal(s.interpretationAttempts,1);assert.equal(s.requests.length,0);
 s=await event(inbox,runtime,early);assert.match(last(s).text,/no longer current/);assert.equal(s.conversation.draft[0].productConfirmation,undefined);
 s=await text(inbox,runtime,'review');s=await text(inbox,runtime,'add into the catalog');assert.ok(s.conversation.draft[0].productConfirmation);assert.equal(s.conversation.pending?.kind,'review');assert.equal(last(s).kind,'order_review');assert.equal(last(s).cards?.length,1);assert.equal(s.requests.length,0);
 s=await event(inbox,runtime,{id:randomUUID(),type:'set_quantity',lineId:s.conversation.draft[0].id,quantity:6,expectedVersion:s.conversation.version});assert.equal(s.conversation.pending?.kind,'review');assert.ok(s.conversation.draft[0].productConfirmation);assert.equal(s.interpretationAttempts,1);
 const submit=last(s).buttons![0].event;s=await event(inbox,runtime,submit);assert.equal(s.requests.length,1);await inbox.ingest(submit);assert.equal(await runtime.processNext(inbox.context),false);assert.equal((await inbox.snapshot()).requests.length,1);
}));

test('sequential lists finish each product and its amount before moving to the next, then show an itemized review',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'PVC elbow',quantity:null},{kind:'add_item',query:'SOLVENT',quantity:5},{kind:'add_item',query:'PTFE-TAPE',quantity:4}]),{sequentialItems:true});
 let s=await text(inbox,runtime,'elbow, five bottles solvent, four tape rolls');const ids=s.conversation.draft.map(l=>l.id);
 assert.equal(s.conversation.pending?.kind,'products');if(s.conversation.pending?.kind!=='products')throw new Error();assert.equal(s.conversation.pending.groups.length,1);assert.equal(s.conversation.pending.groups[0].lineId,ids[0]);assert.equal(s.conversation.pending.remaining,2);assert.ok(last(s).cards!.every(c=>c.action?.type==='select_product'&&c.action.lineId===ids[0]));
 const stale=choice(s,'PVC-ELBOW-050');s=await event(inbox,runtime,stale);assert.equal(s.conversation.pending?.kind,'question');if(s.conversation.pending?.kind!=='question')throw new Error();assert.equal(s.conversation.pending.lineId,ids[0]);assert.ok(s.conversation.draft[0].productConfirmation);assert.equal(s.conversation.draft[1].productConfirmation,undefined);
 s=await text(inbox,runtime,'three');assert.equal(s.conversation.draft[0].quantity,3);assert.equal(s.conversation.pending?.kind,'products');if(s.conversation.pending?.kind!=='products')throw new Error();assert.deepEqual(s.conversation.pending.groups.map(g=>g.lineId),[ids[1]]);assert.equal(s.conversation.pending.remaining,1);
 const before=s.conversation;s=await event(inbox,runtime,{...stale,id:randomUUID()});assert.deepEqual(s.conversation,before);
 s=await text(inbox,runtime,'review');s=await event(inbox,runtime,choice(s,'SOLVENT'));assert.equal(s.conversation.pending?.kind,'products');if(s.conversation.pending?.kind!=='products')throw new Error();assert.deepEqual(s.conversation.pending.groups.map(g=>g.lineId),[ids[2]]);
 s=await event(inbox,runtime,choice(s,'PTFE-TAPE'));assert.equal(s.conversation.pending?.kind,'review');assert.deepEqual(s.conversation.draft.map(l=>l.quantity),[3,5,4]);assert.ok(s.conversation.draft.every(l=>l.productConfirmation));assert.match(last(s).text,/5 bottles × ₹85.00 = ₹425.00/);assert.equal(s.interpretationAttempts,1);assert.equal(s.requests.length,0);
 s=await event(inbox,runtime,last(s).buttons![0].event);assert.equal(s.requests.length,1);assert.deepEqual(s.requests[0].lines.map(l=>l.quantity),[3,5,4]);
}));
test('sequential lists retain bulk confirmation for initially exact complete requests',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'SOLVENT',quantity:2},{kind:'add_item',query:'PTFE-TAPE',quantity:3}]),{sequentialItems:true});
 let s=await text(inbox,runtime,'two solvent and three tape');assert.equal(s.conversation.pending?.kind,'products');if(s.conversation.pending?.kind!=='products')throw new Error();assert.equal(s.conversation.pending.groups.length,2);const all=last(s).buttons!.find(b=>b.event.type==='confirm_products')!;s=await event(inbox,runtime,all.event);assert.equal(s.conversation.pending?.kind,'review');assert.equal(s.requests.length,0);
}));
test('an absent first item cannot be skipped by later available product choices',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'nonexistent electric screwdriver',quantity:1},{kind:'add_item',query:'SOLVENT',quantity:2}]),{sequentialItems:true});
 let s=await text(inbox,runtime,'screwdriver then solvent');assert.equal(s.conversation.pending?.kind,'question');if(s.conversation.pending?.kind!=='question')throw new Error();assert.equal(s.conversation.pending.lineId,s.conversation.draft[0].id);assert.equal(last(s).cards?.length??0,0);const second=s.conversation.draft[1].id;
 s=await text(inbox,runtime,'remove it');assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].id,second);assert.equal(s.conversation.pending?.kind,'products');assert.equal(s.requests.length,0);
}));
test('product acceptance with a missing quantity asks bottles, then 5 bottles works offline',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'SOLVENT',quantity:null}]));let s=await text(inbox,runtime,'I want solvent');s=await event(inbox,runtime,choice(s,'SOLVENT'));assert.equal(s.conversation.pending?.kind,'question');assert.match(last(s).text,/How many bottles/);s=await text(inbox,runtime,'five bottles please');assert.equal(s.conversation.draft[0].quantity,5);assert.equal(s.conversation.pending?.kind,'review');assert.equal(s.interpretationAttempts,1);assert.equal(s.requests.length,0);
}));

test('mixed requests retain each line and group exact matches and alternatives into one bounded reply',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'PVC elbow',quantity:2},{kind:'add_item',query:'SOLVENT',quantity:5},{kind:'add_item',query:'PTFE-TAPE',quantity:4}]));let s=await text(inbox,runtime,'two elbows, five bottles solvent, four tape rolls');const ids=s.conversation.draft.map(l=>l.id);assert.equal(s.conversation.pending?.kind,'products');if(s.conversation.pending?.kind!=='products')throw new Error();assert.equal(s.conversation.pending.groups.length,3);assert.equal(last(s).cards?.length,4);assert.equal(last(s).outboundMessages,1);assert.ok(last(s).buttons?.some(b=>b.event.type==='shopping_action'&&b.event.action==='options'));
 s=await text(inbox,runtime,'yes');assert.equal(s.conversation.pending?.kind,'products');assert.match(last(s).text,/choose the product/);assert.ok(s.conversation.draft.every(l=>!l.productConfirmation));
 s=await text(inbox,runtime,'review');s=await event(inbox,runtime,choice(s,'PVC-ELBOW-050'));assert.equal(s.conversation.pending?.kind,'products');assert.equal(last(s).cards?.length,2);s=await event(inbox,runtime,last(s).buttons![0].event);assert.deepEqual(s.conversation.draft.map(l=>l.id),ids);assert.ok(s.conversation.draft.every(l=>l.productConfirmation));assert.equal(s.conversation.pending?.kind,'review');assert.equal(last(s).cards?.length,3);assert.equal(s.interpretationAttempts,1);assert.equal(s.requests.length,0);
}));

test('more than ten product options and three requested items are checked on customer-driven pages',async()=>fixture(async(pool,inbox)=>{
 for(let i=1;i<=11;i++)await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,image_path) VALUES($1,$2,$3,'piece',1000,20,'/demo-images/test.jpg')",[simulatorContext.storeId,`VALVE-${i}`,`Test valve size ${i}`]);
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'test valve',quantity:1},{kind:'add_item',query:'SOLVENT',quantity:2},{kind:'add_item',query:'PTFE-TAPE',quantity:3},{kind:'add_item',query:'HAMMER-500',quantity:1}]));let s=await text(inbox,runtime,'valve plus solvent tape hammer');assert.equal(last(s).cards?.length,10);assert.equal(last(s).remainingChoices,3);assert.equal(s.messages.filter(m=>m.direction==='outbound').length,1);
 s=await event(inbox,runtime,last(s).cards![0].action!);assert.equal(last(s).cards?.length,3);assert.equal(s.messages.filter(m=>m.direction==='outbound').length,2);s=await text(inbox,runtime,'add these');assert.equal(s.conversation.pending?.kind,'review');assert.ok(s.conversation.draft.every(l=>l.productConfirmation));assert.equal(s.requests.length,0);
}));

test('unshown, foreign, duplicate and queued product confirmations cannot approve another choice',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'SOLVENT',quantity:2},{kind:'add_item',query:'PTFE-TAPE',quantity:1}]));await inbox.ingest({id:randomUUID(),type:'text',text:'solvent and tape'});await inbox.ingest({id:randomUUID(),type:'text',text:'yes'});await runtime.processNext(inbox.context);await runtime.processNext(inbox.context);let s=await inbox.snapshot();assert.match(last(s).text,/earlier product check/);assert.ok(s.conversation.draft.every(l=>!l.productConfirmation));
 s=await text(inbox,runtime,'review');if(s.conversation.pending?.kind!=='products')throw new Error();const pending=s.conversation.pending,before=s.conversation;
 s=await event(inbox,runtime,{id:randomUUID(),type:'select_product',batchId:pending.id,lineId:pending.groups[0].lineId,sku:'HAMMER-500'});assert.deepEqual(s.conversation,before);assert.match(last(s).text,/not shown/);
 const tools=new RetailTools(pool),args={batchId:pending.id,choices:[{lineId:pending.groups[0].lineId,sku:'SOLVENT'}]};await assert.rejects(tools.invoke(inbox.context,{name:'confirm_product_choices',args},'no-consent'),/requires/);
 await assert.rejects(tools.invoke({...inbox.context,consentProductBatchId:pending.id},{name:'confirm_product_choices',args:{...args,choices:[...args.choices,...args.choices]}},'duplicate'),/one product per/);
 s=await event(inbox,runtime,{id:randomUUID(),type:'select_product',batchId:randomUUID(),lineId:pending.groups[0].lineId,sku:'SOLVENT'});assert.deepEqual(s.conversation,before);
}));

test('corrections replace the original line, and catalog identity changes revoke photo acceptance',async()=>fixture(async(pool,inbox)=>{
 let calls=0;const provider:Interpreter={name:'correction-plan',mode:'mock',interpret:async input=>({output:++calls===1?{operations:[{kind:'add_item',query:'SOLVENT',quantity:2}],next:'review'}:{operations:[{kind:'resolve_line',lineId:input.state.draft[0].id,query:'PTFE-TAPE',quantity:2}],next:'review'},truncated:false,usage:null})};const runtime=new ConversationRuntime(pool,provider);let s=await text(inbox,runtime,'solvent');const id=s.conversation.draft[0].id;s=await event(inbox,runtime,choice(s,'SOLVENT'));assert.equal(s.conversation.pending?.kind,'review');s=await text(inbox,runtime,'wrong, I meant tape');assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].id,id);assert.equal(s.conversation.draft[0].productConfirmation,undefined);assert.equal(last(s).cards![0].product.sku,'PTFE-TAPE');
 s=await event(inbox,runtime,choice(s,'PTFE-TAPE'));assert.equal(s.conversation.pending?.kind,'review');await pool.query("UPDATE products SET version=version+1,image_path='/demo-images/new.jpg' WHERE store_id=$1 AND sku='PTFE-TAPE'",[simulatorContext.storeId]);s=await text(inbox,runtime,'review');assert.equal(s.conversation.pending?.kind,'products');assert.equal(s.conversation.draft[0].productConfirmation,undefined);assert.equal(last(s).cards![0].product.imageUrl,'/demo-images/new.jpg');assert.equal(s.requests.length,0);
}));

test('a displayed browse choice counts as photo acceptance; an invented callback must show a product check',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([]));let s=await event(inbox,runtime,{id:randomUUID(),type:'browse',query:'SOLVENT',expectedVersion:0});const displayed=choice(s,'SOLVENT');s=await event(inbox,runtime,displayed);assert.equal(s.conversation.pending?.kind,'question');assert.ok(s.conversation.draft[0].productConfirmation);
 s=await text(inbox,runtime,'clear my list');s=await event(inbox,runtime,{id:randomUUID(),type:'choose_product',sku:'SOLVENT',quantity:3,expectedVersion:s.conversation.version});assert.equal(s.conversation.pending?.kind,'products');assert.equal(s.conversation.draft[0].productConfirmation,undefined);assert.equal(s.requests.length,0);
}));

test('quantity ambiguity and packaging mismatch never confirm or convert products',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'SOLVENT',quantity:null},{kind:'add_item',query:'PTFE-TAPE',quantity:null}]));let s=await text(inbox,runtime,'solvent and tape');const before=s.conversation;s=await text(inbox,runtime,'5');assert.deepEqual(s.conversation,before);assert.match(last(s).text,/Which item/);s=await text(inbox,runtime,'5 bottles');assert.equal(s.conversation.draft[0].quantity,5);assert.equal(s.conversation.draft[1].quantity,null);assert.ok(s.conversation.draft.every(l=>!l.productConfirmation));assert.equal(s.interpretationAttempts,1);
}));


test('twenty requested lines use pages of at most three and never fan out automatically',async()=>fixture(async(pool,inbox)=>{
 const operations:Operation[]=[];for(let i=0;i<20;i++){const sku=`PART-${i}`;await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,image_path) VALUES($1,$2,$3,'piece',1000,30,'/demo-images/test.jpg')",[simulatorContext.storeId,sku,`Unique part ${i}`]);operations.push({kind:'add_item',query:sku,quantity:1});}
 const runtime=new ConversationRuntime(pool,planner(operations));let s=await text(inbox,runtime,'twenty different parts');let pages=0;
 while(s.conversation.pending?.kind==='products'){pages++;assert.ok(s.conversation.pending.groups.length<=3);assert.ok(last(s).cards!.length<=10);assert.equal(last(s).outboundMessages,1);assert.equal(s.requests.length,0);s=await event(inbox,runtime,last(s).buttons![0].event);}
 assert.equal(pages,7);assert.equal(s.conversation.draft.length,20);assert.ok(s.conversation.draft.every(l=>l.productConfirmation));assert.equal(last(s).kind,'order_review');assert.equal(last(s).cards?.length,10);assert.equal(s.interpretationAttempts,1);
}));

test('changed products reject atomic bulk acceptance; missing photos have an explicit fallback',async()=>fixture(async(pool,inbox)=>{
 await pool.query("UPDATE products SET image_path=NULL WHERE store_id=$1 AND sku='SOLVENT'",[simulatorContext.storeId]);const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'SOLVENT',quantity:1},{kind:'add_item',query:'PTFE-TAPE',quantity:2}]));let s=await text(inbox,runtime,'solvent and tape');assert.equal(last(s).cards![0].product.imageUrl,undefined);assert.equal(last(s).presentation,'list');const before=s.conversation,bulk=last(s).buttons![0].event;
 await pool.query("UPDATE products SET name='Updated PTFE tape',version=version+1 WHERE store_id=$1 AND sku='PTFE-TAPE'",[simulatorContext.storeId]);s=await event(inbox,runtime,bulk);assert.deepEqual(s.conversation,before);assert.match(last(s).text,/product details changed/);assert.ok(s.conversation.draft.every(l=>!l.productConfirmation));assert.equal(s.requests.length,0);
}));

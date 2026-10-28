import {spawnSync} from 'node:child_process';
import {pcmWav} from '../apps/server/src/services/voice-media.js';
import {decideCatalogReview,readCatalogReviewFeedback,readCatalogReviewAudio,resolveCatalogReviewFeedback} from '../apps/server/src/services/catalog-review.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {Client} from '@modelcontextprotocol/client';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';
import {catalogAudit,saveCatalogAudit,getCatalogAudit,previewCatalogAuditBatch,applyCatalogAudit,undoCatalogAudit,recordConversationAudit} from '../apps/server/src/services/catalog-audit.js';
import {catalogAiActivity} from '../apps/server/src/services/catalog-ai-activity.js';
import {mutate} from '../apps/server/src/services/catalog-chat.js';
import {ownerStockAction,ownerProductVisibility} from '../apps/server/src/services/owner-mcp-actions.js';
import {catalogMcpServer} from '../apps/server/src/mcp/catalog-server.js';
import {createApp} from '../apps/server/src/http/app.js';
import {visualReply} from '../apps/server/src/services/visual-ordering.js';
import {trackItemClarification} from '../apps/server/src/services/item-clarification.js';
import {cartChangeFeedback} from '../apps/server/src/services/cart-change-feedback.js';
import {existingMention} from '../apps/server/src/adapters/mention-reconciliation.js';
import type {ConversationState} from '../packages/contracts/index.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {CatalogOAuth} from '../apps/server/src/mcp/oauth.js';

const id=()=>randomUUID(),p={storeId:fixtureStore,actor:'audit-test-owner',canWrite:true,canPublish:true,canReadOwner:true};
const sku='PVC-ELBOW-050',range=()=>({since:new Date(Date.now()-6*3600000).toISOString(),until:new Date(Date.now()+1000).toISOString()});
async function fixture(run:(pool:pg.Pool)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='audit_'+id().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema});
 try{await setupDatabase(pool,'mock');await run(pool);}finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
}
async function message(pool:pg.Pool,text='I need a local elbow name',conversationId=fixtureConversation,direction='inbound'){
 const messageId=id();await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) VALUES($1,$2,$3,$4,'processed','{}')",[messageId,conversationId,direction,text]);return messageId;
}
async function suggestion(pool:pg.Pool,options:{sku?:string;term?:string;category?:string;messageId?:string;auditId?:string}={}){
 const target=options.sku??sku,wording=options.term??'local elbow name',messageId=options.messageId??await message(pool,'I need '+wording),auditId=options.auditId??id(),findingId=id(),period=range();
 const product=(await pool.query('SELECT version FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,target])).rows[0];
 const saved=await saveCatalogAudit(pool,p,{operationId:id(),auditId,title:'Customer product matching audit',range:period,reviewedMessageIds:[messageId],findings:[{id:findingId,category:options.category??'alias_gap',sku:target,expectedProductVersion:product.version,wording,explanation:'Customer wording refers to this owner-reviewed product.',patch:{aliases:{add:[wording]}},evidence:[{conversationId:fixtureConversation,messageIds:[messageId]}]}]}) as any;
 return {auditId,findingId,period,messageId,saved,apply:{operationId:id(),auditId,findingIds:[findingId]}};
}
class Transport{peer?:Transport;onmessage?:(m:any)=>void;onclose?:()=>void;onerror?:(e:Error)=>void;async start(){}async send(m:any){queueMicrotask(()=>this.peer?.onmessage?.(m));}async close(){this.onclose?.();}}
async function connect(pool:pg.Pool,scope:typeof p,run:(client:Client)=>Promise<void>){const client=new Client({name:'audit-fixture',version:'1'}),server=catalogMcpServer(pool,scope),a=new Transport(),b=new Transport();a.peer=b;b.peer=a;await server.connect(a);await client.connect(b);try{await run(client);}finally{await client.close();await server.close();}}

test('a stalled unrelated item cannot replace the current product question',()=>{
 const old={id:'old',name:'unknown part',query:'unknown part',quantity:1,resolution:'unavailable' as const,clarification:{signature:'old',unproductiveTurns:2}},current={id:'new',name:'screwdriver',query:'screwdriver',quantity:1,resolution:'unavailable' as const};
 const state:ConversationState={version:3,draft:[old,current],pending:{kind:'question',id:'q',lineId:'new',version:3},lastRequestId:null,fulfillment:'pickup',visualOrdering:true,allowPartialReview:true,replyLanguage:'en'};
 const base={version:1 as const,kind:'text' as const,text:'Which screwdriver do you need?',stage:'identify' as const,presentation:'text' as const,outboundMessages:1};
 assert.equal(visualReply(base,state).text,base.text);
 const focused={...state,pending:{kind:'question' as const,id:'q',lineId:'old',version:3}};assert.match(visualReply(base,focused).text,/kept your request/);
 const candidates={...focused,draft:[{...old,resolution:'needs_choice' as const,candidates:[{sku:'real-screwdriver',version:1} as any]},current]};assert.equal(visualReply(base,candidates).text,base.text);
 const readOnly=visualReply({...base,readOnly:true},focused);assert.equal(readOnly.text,base.text);
});

test('new candidates are progress and unrelated cart activity does not advance old clarification',()=>{
 const state:ConversationState={version:1,draft:[{id:'old',name:'screwdriver',query:'screwdriver',quantity:1,resolution:'unavailable'}],pending:{kind:'question',id:'q',lineId:'old',version:1},lastRequestId:null,fulfillment:'pickup'};
 const first=structuredClone(state);trackItemClarification(state,first);assert.equal(first.draft[0].clarification?.unproductiveTurns,1);
 const next=structuredClone(first);next.draft[0].resolution='needs_choice';next.draft[0].candidates=[{sku:'actual-product',version:1} as any];trackItemClarification(first,next);assert.equal(next.draft[0].clarification?.unproductiveTurns,0);
 const unrelated=structuredClone(next);unrelated.draft.push({id:'new',name:'hose',query:'hose',quantity:null,resolution:'unavailable'});trackItemClarification(next,unrelated,'new');assert.deepEqual(unrelated.draft[0].clarification,next.draft[0].clarification);
});

test('unmatched additions describe requests and explicit corrections retain their current target',()=>{
 const state:ConversationState={version:1,draft:[{id:'a',name:'rasam',query:'rasam',quantity:1,resolution:'unavailable'}],pending:{kind:'question',id:'q',lineId:'a',version:1},lastRequestId:null,fulfillment:'pickup',replyLanguage:'en'};
 assert.match(cartChangeFeedback({draft:[],replyLanguage:'en'},state)!,/Saved request.*still needs checking/);
 const item={ordinal:0,query:'spirit level',sourceText:'change this item to a spirit level',purchaseCount:1,unresolved:[]};
 assert.equal(existingMention(item,state).line?.id,'a');
 const extra=existingMention({...item,sourceText:'also add another spirit level',requestMode:'additional'},state);assert.equal(extra.line,undefined);
});

test('audit pages every retained message with a stable cutoff and no server writes',()=>fixture(async pool=>{
 const second=id();await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'audit-second')",[second,fixtureStore]);
 for(let i=0;i<7;i++)await message(pool,i===3?'Bearer sk-private-fixture https://example.test/photo?signature=secret':'wording '+i,i%2?second:fixtureConversation);
 const period=range(),seen:string[]=[];let cursor: string|undefined;
 do{const result:any=await catalogAudit(pool,p,{range:period,limit:2,cursor});seen.push(...result.messages.map((m:any)=>m.id));cursor=result.nextCursor??undefined;assert.equal(result.available.messages,7);assert.ok(result.messages.every((m:any)=>m.execution.available===false));assert.ok(!JSON.stringify(result).includes('signature=secret'));}while(cursor);
 assert.equal(new Set(seen).size,7);assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_audit_runs')).rows[0].n,0);
 const first:any=await catalogAudit(pool,p,{range:period,limit:2});await message(pool,'newly arrived');const next:any=await catalogAudit(pool,p,{range:period,limit:100,cursor:first.nextCursor});assert.equal(next.available.messages,7);assert.equal(next.messages.length,5);
 await assert.rejects(catalogAudit(pool,{...p,canReadOwner:false},{}),/owner permission/);
 const foreign=id();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other','true')",[foreign]);await assert.rejects(catalogAudit(pool,{...p,storeId:foreign},{cursor:first.nextCursor}),/another shop/);
 await assert.rejects(catalogAudit(pool,p,{days:32}));await assert.rejects(catalogAudit(pool,p,{timezone:'bad/zone'}));
}));

test('saved findings validate evidence, current products, revisions and independently reported coverage',()=>fixture(async pool=>{
 const s=await suggestion(pool),saved:any=await getCatalogAudit(pool,p,{auditId:s.auditId});assert.equal(saved.findings.length,1);assert.equal(saved.coverage.agentReportedReviewedMessages,1);assert.equal(saved.coverage.allMessageIdsReportedReviewed,true);
 const request={operationId:id(),auditId:s.auditId,expectedVersion:1,title:'Updated review',range:s.period,reviewedMessageIds:[s.messageId,s.messageId],findings:[]};const first=await saveCatalogAudit(pool,p,request);assert.deepEqual(await saveCatalogAudit(pool,p,request),first);
 await assert.rejects(saveCatalogAudit(pool,p,{...request,operationId:id()}),/Reload the audit/);
 await assert.rejects(saveCatalogAudit(pool,p,{operationId:id(),auditId:id(),title:'Invalid evidence audit',range:s.period,reviewedMessageIds:[id()]}),/Cite retained messages/);
 await assert.rejects(suggestion(pool,{term:'invented name',messageId:s.messageId}),/actual customer wording/);
 await assert.rejects(suggestion(pool,{category:'flow_bug'}),/Only name, alias and keyword/);
 await assert.rejects(saveCatalogAudit(pool,{...p,canWrite:false},{...request,operationId:id()}),/catalog permission/);
 await assert.rejects(saveCatalogAudit(pool,{...p,canReadOwner:false},{...request,operationId:id()}),/owner permission/);
}));

test('apply patches only search metadata, preserves merchant facts and records one recoverable live change',()=>fixture(async pool=>{
 await pool.query("UPDATE products SET merchant_verification='{\"identity\":false}',image_path='/existing-photo.jpg',stock=20,reserved_stock=3 WHERE store_id=$1 AND sku=$2",[fixtureStore,sku]);
 const before=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0],s=await suggestion(pool);
 const result:any=await applyCatalogAudit(pool,p,s.apply);assert.equal(result.live,true);assert.equal(result.events.length,1);assert.deepEqual(await applyCatalogAudit(pool,p,s.apply),result);
 const after=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0];
 for(const field of ['stock','reserved_stock','inventory_version','image_path','price_paise','unit','merchant_verification','selling_unit_verified','selling_policy','active'])assert.deepEqual(after[field],before[field],field);
 assert.ok(after.aliases.includes('local elbow name'));assert.match(after.search_text,/local elbow name/);assert.equal(after.version,before.version+1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_change_events')).rows[0].n,1);
 const activity:any=await catalogAiActivity(pool,p,{});assert.equal(activity.items[0].status,'live');assert.equal(activity.items[0].changes.length,1);assert.equal(activity.items[0].changes[0].field,'aliases');assert.equal(activity.items[0].hasPhoto,true);assert.equal(activity.items[0].productVersion,after.version);assert.equal('image_path' in activity.items[0],false);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM whatsapp_outbox')).rows[0].n,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM provider_attempts')).rows[0].n,0);
 await assert.rejects(applyCatalogAudit(pool,{...p,canPublish:false},{...s.apply,operationId:id()}),/catalog permission/);
}));

test('stale multi-product batches roll back entirely and undo respects later edits',()=>fixture(async pool=>{
 const a=await suggestion(pool),b=await suggestion(pool,{sku:'PVC-ELBOW-075',auditId:a.auditId}).catch(()=>null);
 assert.equal(b,null,'an existing audit requires its current revision');
 const other=id(),messageId=await message(pool,'another local name');
 await saveCatalogAudit(pool,p,{operationId:id(),auditId:a.auditId,expectedVersion:1,title:'Batch review',range:a.period,findings:[{id:other,category:'alias_gap',sku:'PVC-ELBOW-075',wording:'another local name',patch:{aliases:{add:['another local name']}},explanation:'Owner reviewed exact variant.',evidence:[{conversationId:fixtureConversation,messageIds:[messageId]}]}]});
 await pool.query('UPDATE products SET version=version+1 WHERE store_id=$1 AND sku=$2',[fixtureStore,'PVC-ELBOW-075']);
 await assert.rejects(applyCatalogAudit(pool,p,{...a.apply,findingIds:[a.findingId,other]}),/entire batch is unchanged/);
 assert.ok(!(await pool.query('SELECT aliases FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0].aliases.includes('local elbow name'));
 const applied:any=await applyCatalogAudit(pool,p,a.apply),undo={operationId:id(),auditId:a.auditId,eventIds:applied.events.map((e:any)=>e.id)};
 const reverted:any=await undoCatalogAudit(pool,p,undo);assert.equal(reverted.products.length,1);assert.deepEqual(await undoCatalogAudit(pool,p,undo),reverted);
 const original:any=await getCatalogAudit(pool,p,{auditId:a.auditId,status:'undone'});assert.equal(original.findings.length,1);
 const fresh=await suggestion(pool,{term:'fresh local name'}),change:any=await applyCatalogAudit(pool,p,fresh.apply);await pool.query('UPDATE products SET version=version+1 WHERE store_id=$1 AND sku=$2',[fixtureStore,sku]);
 await assert.rejects(undoCatalogAudit(pool,p,{operationId:id(),auditId:fresh.auditId,eventIds:change.events.map((e:any)=>e.id)}),/later product edit/);
}));

test('ordinary connected stock and visibility changes record provenance, failed transactions record none',()=>fixture(async pool=>{
 const before=(await pool.query('SELECT inventory_version,version FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0];
 const action={operationId:id(),sku,movement:{expectedVersion:before.inventory_version,kind:'count',quantity:30,reason:'Owner counted stock'}};
 await ownerStockAction(pool,p,action);await ownerStockAction(pool,p,action);
 await ownerProductVisibility(pool,p,{operationId:id(),sku,expectedVersion:before.version,active:false});
 const activity:any=await catalogAiActivity(pool,p,{});assert.equal(activity.items.length,2);assert.ok(activity.items.every((i:any)=>i.status==='hidden'));assert.equal(activity.items[0].action,'visibility');
 const total=activity.total;await assert.rejects(mutate(pool,p,'catalog:publish',id(),'commit',{},async c=>{await c.query("UPDATE products SET aliases='[\"rolled back\"]' WHERE store_id=$1 AND sku=$2",[fixtureStore,sku]);throw Error('Fixture rollback');}));assert.equal((await catalogAiActivity(pool,p,{}) as any).total,total);
 await assert.rejects(ownerStockAction(pool,p,{...action,operationId:id()}));assert.equal((await catalogAiActivity(pool,p,{}) as any).total,total);
}));

test('AI activity keeps unmatched findings out of approval cards and retains historic actions, with scoped stable pagination',()=>fixture(async pool=>{
 const messageId=await message(pool,'unknown thing'),auditId=id();
 await saveCatalogAudit(pool,p,{operationId:id(),auditId,title:'Unidentified request',range:range(),findings:[{id:id(),category:'insufficient_evidence',wording:'unknown thing',explanation:'Ask the owner which product this could mean.',evidence:[{conversationId:fixtureConversation,messageIds:[messageId]}]}]});
 const pending:any=await catalogAiActivity(pool,p,{mode:'review'});assert.equal(pending.total,0);assert.equal((await getCatalogAudit(pool,p,{auditId}) as any).findings.length,1);
 for(let i=0;i<4;i++)await mutate(pool,p,'catalog:publish',id(),'commit',{},async c=>{await c.query('UPDATE products SET keywords=$3 WHERE store_id=$1 AND sku=$2',[fixtureStore,sku,JSON.stringify(['change '+i])]);return {sku};});
 let cursor:string|undefined;const seen:string[]=[];do{const page:any=await catalogAiActivity(pool,p,{limit:1,cursor});seen.push(...page.items.map((i:any)=>i.id));cursor=page.nextCursor??undefined;}while(cursor);assert.equal(new Set(seen).size,4);
 const page:any=await catalogAiActivity(pool,p,{limit:1});await assert.rejects(catalogAiActivity(pool,p,{cursor:page.nextCursor,q:'other filter'}),/another filter/);
 const foreign=id();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Foreign','true')",[foreign]);assert.equal((await catalogAiActivity(pool,{...p,storeId:foreign},{}) as any).total,0);
}));

test('MCP exposes actual audit permissions and invokes the full read/save/apply/undo workflow',()=>fixture(async pool=>{
 await connect(pool,{...p,canReadOwner:false},async client=>assert.ok(!(await client.listTools()).tools.some(t=>t.name==='catalog_audit')));
 await connect(pool,{...p,canWrite:false,canPublish:false},async client=>{const names=(await client.listTools()).tools.map(t=>t.name);assert.ok(names.includes('catalog_audit'));assert.ok(names.includes('catalog_audit_get'));assert.ok(!names.includes('catalog_audit_save'));assert.ok(!names.includes('catalog_audit_apply'));});
 const messageId=await message(pool),auditId=id(),findingId=id();
 await connect(pool,p,async client=>{
  const tools=(await client.listTools()).tools;assert.equal(tools.find(t=>t.name==='catalog_audit')?.annotations?.readOnlyHint,true);assert.equal(tools.find(t=>t.name==='catalog_audit_save')?.annotations?.readOnlyHint,false);
  const call=async(name:string,args:any)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent as any;};
  const evidence=await call('catalog_audit',{range:range()});assert.ok(evidence.messages.some((m:any)=>m.id===messageId));assert.match(evidence.instructions,/owner review cards/);assert.match(evidence.instructions,/catalog_inventory/);const prompt=await client.getPrompt({name:'audit_product_matching'});const content=prompt.messages[0].content;assert.equal(content.type,'text');if(content.type==='text'){assert.match(content.text,/several plausible English, Tamil and Tanglish/);assert.match(content.text,/separate audit for the correct interval/);}
  await call('catalog_audit_save',{operationId:id(),auditId,title:'MCP audit',range:range(),findings:[{id:findingId,sku,category:'alias_gap',wording:'local elbow name',explanation:'Owner reviewed this exact item.',patch:{aliases:{add:['local elbow name']}},evidence:[{conversationId:fixtureConversation,messageIds:[messageId]}]}]});
  assert.equal((await call('catalog_audit_get',{auditId})).findings.length,1);
  assert.deepEqual((await call('catalog_audit_batch_preview',{auditId,findingIds:[findingId]})).readyFindingIds,[findingId]);
  const applied=await call('catalog_audit_apply',{operationId:id(),auditId,findingIds:[findingId]});await call('catalog_audit_undo',{operationId:id(),auditId,eventIds:applied.events.map((e:any)=>e.id)});
 });
}));

test('owner activity HTTP is authenticated and committed turn records exclude raw provider responses',()=>fixture(async pool=>{
 const messageId=await message(pool),c=await pool.connect();try{await recordConversationAudit(c,fixtureStore,fixtureConversation,messageId,{version:0},{version:1,pending:{kind:'question',lineId:'a'},draft:[{id:'a',query:'screwdriver',resolution:'unavailable',discovery:{query:'screwdriver',plan:{keywords:['screwdriver']},products:[],totalCount:0}}]},{stage:'identify',clarificationReason:'stalled_request'});}finally{c.release();}
 const audit:any=await catalogAudit(pool,p,{range:range()});assert.equal(audit.messages[0].execution.activeItemId,'a');assert.equal(audit.messages[0].execution.fallbackReason,'stalled_request');assert.ok(!JSON.stringify(audit).includes('rawText'));
 const owner={hostname:'audit-owner.example.test',issuer:'https://offline.cloudflareaccess.com',audience:'fixture',email:'owner@example.test',storeId:fixtureStore};
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/audit-test-media',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'test'}));
 try{assert.equal((await app.inject({url:'/api/owner/catalog/ai-activity',headers:{host:owner.hostname}})).statusCode,403);const result=await app.inject({url:'/api/owner/catalog/ai-activity?mode=review',headers:{host:owner.hostname,'cf-access-jwt-assertion':'fixture'}});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().mode,'review');}finally{await app.close();}
}));

test('adding another product focuses its real candidates while preserving a stalled request',()=>fixture(async pool=>{
 const old=id();await pool.query("UPDATE conversations SET visual_ordering=true,draft=$2::jsonb WHERE id=$1",[fixtureConversation,JSON.stringify([{id:old,name:'unknown spare',query:'unknown spare',quantity:1,resolution:'unavailable',clarification:{signature:'old',unproductiveTurns:2}}])]);
 const tools=new RetailTools(pool),ctx={storeId:fixtureStore,conversationId:fixtureConversation,actor:'local-simulator',role:'customer' as const};
 const added=await tools.invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'PVC elbow',quantity:null}]}},id());
 assert.equal(added.state!.draft.length,2);assert.notEqual(added.state!.activeItemId,old);
 const preview=await tools.invoke(ctx,{name:'preview_order',args:{expectedVersion:added.state!.version}},id());
 assert.equal(preview.state!.pending?.kind,'products');assert.ok((preview.state!.pending as any).groups.some((g:any)=>g.lineId===added.state!.activeItemId));
 const visual=visualReply({version:1,kind:'text',text:preview.message,presentation:'text',outboundMessages:1},preview.state!);assert.ok(!visual.text.includes('kept your request'));
}));

test('a stalled request can move to its partial estimate without repeating the same prompt or submitting',()=>fixture(async pool=>{
 const line={id:id(),name:'unlisted screwdriver',query:'unlisted screwdriver',quantity:1,resolution:'unavailable',clarification:{signature:'fixture',unproductiveTurns:2}};
 await pool.query('UPDATE conversations SET visual_ordering=true,partial_reviews=true,draft=$2::jsonb WHERE id=$1',[fixtureConversation,JSON.stringify([line])]);
 const ctx={storeId:fixtureStore,conversationId:fixtureConversation,actor:'local-simulator',role:'customer' as const};
 const preview=await new RetailTools(pool).invoke(ctx,{name:'preview_order',args:{expectedVersion:0,allowPartial:true}},id());
 assert.equal(preview.state!.pending?.kind,'review');
 const response=visualReply({version:1,kind:'text',text:preview.message,presentation:'text',outboundMessages:1},preview.state!);
 assert.equal(response.stage,'bill');assert.notEqual(response.clarificationReason,'stalled_request');
 assert.ok(response.parts?.flatMap(p=>p.cards.flatMap(c=>c.buttons??[])).some(b=>b.event.type==='confirm'));
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_requests WHERE conversation_id=$1',[fixtureConversation])).rows[0].n,0);
}));

test('term collisions are disclosed, duplicate additions are no-ops and wrong dimensions are rejected',()=>fixture(async pool=>{
 await pool.query('UPDATE products SET aliases=$3 WHERE store_id=$1 AND sku=$2',[fixtureStore,'PVC-ELBOW-075',JSON.stringify(['local elbow name'])]);
 const s=await suggestion(pool);assert.equal(s.saved.findings[0].otherProductsUsingTerms[0].sku,'PVC-ELBOW-075');
 await pool.query('UPDATE products SET aliases=$3 WHERE store_id=$1 AND sku=$2',[fixtureStore,sku,JSON.stringify(['local elbow name'])]);
 const result:any=await applyCatalogAudit(pool,p,s.apply);assert.equal(result.changes[0].status,'unchanged');assert.equal(result.events.length,0);
 await pool.query("UPDATE products SET specifications='{\"size\":\"15 mm\"}',name='Exact 15 mm elbow' WHERE store_id=$1 AND sku=$2",[fixtureStore,sku]);
 await assert.rejects(suggestion(pool,{term:'20 mm elbow'}),/dimension inconsistent/);
}));

test('a 201-product apply is rejected without partial publication',()=>fixture(async pool=>{
 const auditId=id(),period=range(),messageId=await message(pool,'shared owner term'),findings=[];
 for(let n=0;n<201;n++){const key='BATCH-'+n;await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise) VALUES($1,$2,$3,'piece',100)",[fixtureStore,key,'Fixture '+n]);findings.push({id:id(),category:'alias_gap',sku:key,wording:'shared owner term',explanation:'Owner identified this exact listed variant.',patch:{aliases:{add:['shared owner term']}},evidence:[{conversationId:fixtureConversation,messageIds:[messageId]}]});}
 let version=0;for(let n=0;n<findings.length;n+=25){const saved:any=await saveCatalogAudit(pool,p,{operationId:id(),auditId,expectedVersion:version,title:'Batch limits',range:period,findings:findings.slice(n,n+25)});version=saved.version;}
 await assert.rejects(applyCatalogAudit(pool,p,{operationId:id(),auditId,findingIds:findings.map(f=>f.id)}),/at most 200 products/);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM products WHERE sku LIKE 'BATCH-%' AND aliases<>'[]'::jsonb")).rows[0].n,0);
 const batch:any=await applyCatalogAudit(pool,p,{operationId:id(),auditId,findingIds:findings.slice(0,200).map(f=>f.id)});assert.equal(batch.changes.length,200);assert.equal(batch.events.length,200);
}));

test('findings can be dismissed or resumed across connected owner chats without modifying products',()=>fixture(async pool=>{
 const s=await suggestion(pool),other={...p,actor:'another-owner-connection'},current:any=await getCatalogAudit(pool,other,{auditId:s.auditId});const f=current.findings[0];
 await saveCatalogAudit(pool,other,{operationId:id(),auditId:s.auditId,expectedVersion:1,title:'Review completed',range:s.period,findings:[{id:f.id,expectedVersion:f.version,category:f.category,status:'dismissed',sku:f.sku,wording:f.wording,explanation:'Owner says this expression refers to a different product.',patch:f.patch,evidence:f.evidence}]});
 assert.equal((await catalogAiActivity(pool,p,{mode:'review'}) as any).total,0);assert.equal((await getCatalogAudit(pool,p,{auditId:s.auditId,status:'dismissed'}) as any).findings.length,1);
 await assert.rejects(applyCatalogAudit(pool,p,s.apply),/current alias\/keyword/);assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_change_events')).rows[0].n,0);
}));

test('OAuth clients supply recorded application identity and revocation/expiry block all audit actions',()=>fixture(async pool=>{
 const owner={hostname:'owner.example.test',issuer:'https://fixture.cloudflareaccess.com',audience:'fixture',email:'owner@example.test',storeId:fixtureStore},remote={publicUrl:'https://mcp.example.test/mcp'},oauth=new CatalogOAuth(pool,remote,owner);
 const cl=await oauth.register({client_name:'ChatGPT fixture',redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect']});
 const grantId=id();await pool.query('INSERT INTO mcp_oauth_grants(id,store_id,actor,client_id,scopes,resource) VALUES($1,$2,$3,$4,$5,$6)',[grantId,fixtureStore,owner.email,cl.client_id,['catalog:read','catalog:draft','catalog:publish','owner:read'],remote.publicUrl]);
 const principal={...p,actor:owner.email+'/mcp/'+grantId,grantId,ownerActor:owner.email,resource:remote.publicUrl},s=await suggestion(pool);
 await applyCatalogAudit(pool,principal,s.apply);assert.equal((await catalogAiActivity(pool,p,{}) as any).items[0].applicationName,'ChatGPT fixture');
 await oauth.disconnect(grantId);await assert.rejects(catalogAudit(pool,principal,{}),/revoked/);await assert.rejects(applyCatalogAudit(pool,principal,{...s.apply,operationId:id()}),/revoked/);
 await assert.rejects(catalogAudit(pool,{...p,accessExpiresAt:1},{}),/expired/);
}));

test('migration backfills only supported live product receipts and repeat setup preserves data',()=>fixture(async pool=>{
 const operation=id();await pool.query("INSERT INTO catalog_chat_operations(store_id,id,actor,action,input_hash,result) VALUES($1,$2,'historical-owner','commit','fixture',$3)",[fixtureStore,operation,JSON.stringify({sku})]);
 const before=(await pool.query('SELECT row_to_json(p) AS data FROM products p WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0].data;
 await pool.query('DROP TABLE catalog_review_feedback; ALTER TABLE catalog_audit_findings DROP COLUMN explanation_ta; DELETE FROM schema_migrations WHERE version=52; DROP TRIGGER products_connected_activity ON products; DROP FUNCTION record_connected_catalog_change(); DROP TABLE conversation_audit_events,catalog_change_events,catalog_audit_reviews,catalog_audit_findings,catalog_audit_runs; ALTER TABLE conversations DROP COLUMN active_item_id; DELETE FROM schema_migrations WHERE version=50');
 await setupDatabase(pool,'mock');await setupDatabase(pool,'mock');
 const events:any=await catalogAiActivity(pool,p,{});assert.equal(events.total,1);assert.equal(events.items[0].historical,true);assert.equal(events.items[0].changes,null);assert.match(events.items[0].historyNote,/unavailable/);
 assert.deepEqual((await pool.query('SELECT row_to_json(p) AS data FROM products p WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0].data,before);
}));


test('saved scan progress resumes the exact conversation cutoff and previous calendar days exclude today',()=>fixture(async pool=>{
 const other=id();await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'other-scope')",[other,fixtureStore]);
 const firstId=await message(pool),secondId=await message(pool);await message(pool,'other conversation',other);
 const page:any=await catalogAudit(pool,p,{range:range(),conversationId:fixtureConversation,limit:1});
 const auditId=id(),scanProgress={nextCursor:page.nextCursor,highwater:page.coverage.highwater,fetchedThroughCursor:page.coverage.fetchedThroughCursor};
 const saved:any=await saveCatalogAudit(pool,p,{operationId:id(),auditId,title:'Scoped resumable audit',range:page.range,conversationId:fixtureConversation,scanProgress,reviewedMessageIds:[firstId]});
 assert.equal(saved.coverage.available.messages,2);assert.equal(saved.coverage.allMessageIdsReportedReviewed,false);
 const resumed:any=await getCatalogAudit(pool,p,{auditId});assert.deepEqual(resumed.coverage.scanProgress,scanProgress);
 const next:any=await catalogAudit(pool,p,{conversationId:resumed.coverage.conversationId,cursor:resumed.coverage.scanProgress.nextCursor});assert.equal(next.messages[0].id,secondId);
 const operationId=id(),request={operationId,auditId,expectedVersion:1,title:'Scoped resumable audit',range:page.range,conversationId:fixtureConversation,reviewedMessageIds:[secondId]};await saveCatalogAudit(pool,p,request);
 await assert.rejects(saveCatalogAudit(pool,{...p,canReadOwner:false},request),/owner permission/);
 const defaults:any=await catalogAudit(pool,p,{});assert.ok(Date.parse(defaults.range.until)-Date.parse(defaults.range.since)>=6*86400000);assert.ok(Date.parse(defaults.range.until)-Date.parse(defaults.range.since)<=7*86400000);assert.ok(Math.abs(Date.now()-Date.parse(defaults.range.until))<10000);
}));

test('needs-review pagination preserves microseconds for findings created together',()=>fixture(async pool=>{
 const messageId=await message(pool,'local fixture name'),auditId=id();await saveCatalogAudit(pool,p,{operationId:id(),auditId,title:'Same timestamp review queue',range:range(),findings:Array.from({length:5},()=>({id:id(),category:'alias_gap',sku,wording:'local fixture name',explanation:'A search term for this product.',patch:{aliases:{add:['local fixture name']}},evidence:[{conversationId:fixtureConversation,messageIds:[messageId]}]}))});
 let cursor:string|undefined;const ids:string[]=[];do{const page:any=await catalogAiActivity(pool,p,{mode:'review',limit:2,cursor});ids.push(...page.items.map((r:any)=>r.id));cursor=page.nextCursor??undefined;}while(cursor);assert.equal(ids.length,5);assert.equal(new Set(ids).size,5);
}));

test('bulk review groups 35 products, reports stale items, applies the ready selection atomically and retries safely',()=>fixture(async pool=>{
 const auditId=id(),messageId=await message(pool,'local fixture name'),period=range();
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,image_path,aliases,keywords) SELECT $1,'BULK-'||n,'Fixture product '||n,'piece',10000,5,'/fixture/photo.jpg','[]'::jsonb,'[]'::jsonb FROM generate_series(1,35) n",[fixtureStore]);
 const findings=Array.from({length:35},(_,i)=>({id:id(),category:'alias_gap',sku:'BULK-'+(i+1),wording:'local fixture name',explanation:'Reviewed fixture product.',patch:{aliases:{add:['local fixture name']}},evidence:[{conversationId:fixtureConversation,messageIds:[messageId]}]}));
 const first:any=await saveCatalogAudit(pool,p,{operationId:id(),auditId,title:'Bulk audit',range:period,findings:findings.slice(0,25)});
 await saveCatalogAudit(pool,p,{operationId:id(),auditId,expectedVersion:first.version,title:'Bulk audit',range:period,findings:findings.slice(25)});
 const ids=findings.map(f=>f.id),initial:any=await previewCatalogAuditBatch(pool,p,{auditId,findingIds:ids});assert.equal(initial.productCount,35);assert.equal(initial.readyFindingIds.length,35);assert.equal(initial.canApplyAll,true);
 await pool.query("UPDATE products SET version=version+1 WHERE store_id=$1 AND sku='BULK-1'",[fixtureStore]);
 const checked:any=await previewCatalogAuditBatch(pool,p,{auditId,findingIds:ids});assert.equal(checked.readyFindingIds.length,34);assert.deepEqual(checked.blocked[0].issues,['product_changed']);
 await assert.rejects(applyCatalogAudit(pool,p,{operationId:id(),auditId,findingIds:ids}),/entire batch is unchanged/);
 assert.equal((await pool.query("SELECT count(*)::int n FROM products WHERE store_id=$1 AND sku LIKE 'BULK-%' AND aliases @> '[\"local fixture name\"]'",[fixtureStore])).rows[0].n,0);
 const request={operationId:id(),auditId,findingIds:checked.readyFindingIds};const applied:any=await applyCatalogAudit(pool,p,request);assert.equal(applied.changes.length,34);assert.deepEqual(await applyCatalogAudit(pool,p,request),applied);
 const unchanged=await pool.query("SELECT count(*)::int n FROM products WHERE store_id=$1 AND sku LIKE 'BULK-%' AND (stock<>5 OR price_paise<>10000 OR image_path<>'/fixture/photo.jpg')",[fixtureStore]);assert.equal(unchanged.rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM whatsapp_outbox')).rows[0].n,0);
}));

test('bulk preview identifies contradictory additions and removals on one product before any write',()=>fixture(async pool=>{
 const first=await suggestion(pool),second=id();
 await saveCatalogAudit(pool,p,{operationId:id(),auditId:first.auditId,expectedVersion:1,title:'Conflict review',range:first.period,findings:[{id:second,category:'alias_gap',sku,wording:'local elbow name',explanation:'A conflicting correction requires reconciliation.',patch:{aliases:{remove:['local elbow name']}},evidence:[{conversationId:fixtureConversation,messageIds:[first.messageId]}]}]});
 const findingIds=[first.findingId,second],result:any=await previewCatalogAuditBatch(pool,p,{auditId:first.auditId,findingIds});assert.equal(result.canApplyAll,false);assert.equal(result.readyFindingIds.length,0);assert.deepEqual(result.blocked[0].issues,['conflicting_terms']);
 await assert.rejects(applyCatalogAudit(pool,p,{operationId:id(),auditId:first.auditId,findingIds}),/disagree about a term/);
 assert.ok(!(await pool.query('SELECT aliases FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0].aliases.includes('local elbow name'));
}));


test('owner swipe applies exactly the displayed revision, preserves unrelated facts, and retries once',()=>fixture(async pool=>{
 const s=await suggestion(pool),before=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0];
 const input={operationId:id(),auditId:s.auditId,findingId:s.findingId,findingVersion:1,decision:'approve'};
 const result:any=await decideCatalogReview(pool,p,input);assert.equal(result.decision,'applied');assert.equal(result.customerMessagesSent,0);
 const after=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0];assert.ok(after.aliases.includes('local elbow name'));
 for(const k of ['price_paise','stock','unit','image_path'])assert.deepEqual(after[k],before[k]);assert.deepEqual(await decideCatalogReview(pool,p,input),result);
 const stale=await suggestion(pool,{term:'other name'});await pool.query('UPDATE products SET version=version+1 WHERE store_id=$1 AND sku=$2',[fixtureStore,sku]);
 await assert.rejects(decideCatalogReview(pool,p,{operationId:id(),auditId:stale.auditId,findingId:stale.findingId,findingVersion:1,decision:'approve'}),/product changed/i);
}));

test('recorded owner feedback is held, exposed only to authorized AI, and returned to review after a fresh finding',()=>fixture(async pool=>{
 const s=await suggestion(pool);const pcm=Buffer.alloc(16000);for(let n=0;n<8000;n++)pcm.writeInt16LE(Math.round(1200*Math.sin(n/10)),n*2);const encoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i','pipe:0','-f','webm','-c:a','libopus','pipe:1'],{input:pcmWav(pcm)});assert.equal(encoded.status,0);const input={operationId:id(),auditId:s.auditId,findingId:s.findingId,findingVersion:1,decision:'approve',audio:{mime:'audio/webm',data:encoded.stdout.toString('base64')}};
 const pending:any=await decideCatalogReview(pool,p,input);assert.equal(pending.decision,'queued_for_ai');assert.equal(pending.published,false);
 assert.equal((await catalogAiActivity(pool,p,{mode:'review'}) as any).total,0);assert.equal((await pool.query('SELECT aliases FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0].aliases.includes('local elbow name'),false);
 await assert.rejects(applyCatalogAudit(pool,p,s.apply),/feedback/);assert.ok((await previewCatalogAuditBatch(pool,p,{auditId:s.auditId,findingIds:[s.findingId]}) as any).blocked[0].issues.includes('feedback_pending'));await assert.rejects(readCatalogReviewFeedback(pool,{...p,canReadOwner:false},{}),/owner permission/);
 const feedback:any=await readCatalogReviewFeedback(pool,p,{});assert.equal(feedback.items[0].hasAudio,true);assert.equal((await readCatalogReviewAudio(pool,p,{feedbackId:input.operationId,format:'original'})).data,input.audio.data);
 await connect(pool,p,async client=>{const response:any=await client.callTool({name:'catalog_review_audio',arguments:{feedbackId:input.operationId}});assert.equal(response.isError,undefined);assert.equal(response.content[0].type,'audio');assert.equal(response.content[0].mimeType,'audio/wav');assert.equal(Buffer.from(response.content[0].data,'base64').subarray(0,4).toString(),'RIFF');});
 const current:any=await getCatalogAudit(pool,p,{auditId:s.auditId});const f=current.findings[0];
 await saveCatalogAudit(pool,p,{operationId:id(),auditId:s.auditId,expectedVersion:current.audit.version,title:'Review after voice',range:s.period,findings:[{id:f.id,expectedVersion:f.version,category:f.category,sku:f.sku,wording:f.wording,explanation:'Updated after owner feedback.',patch:f.patch,evidence:f.evidence}]});
 await resolveCatalogReviewFeedback(pool,p,{operationId:id(),feedbackId:input.operationId,findingVersion:2});assert.equal((await catalogAiActivity(pool,p,{mode:'review'}) as any).total,1);
}));

test('name corrections use current product revision and can be safely undone',()=>fixture(async pool=>{
 const s=await suggestion(pool),current:any=await getCatalogAudit(pool,p,{auditId:s.auditId});const f=current.findings[0],before=(await pool.query('SELECT name FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0].name;
 await saveCatalogAudit(pool,p,{operationId:id(),auditId:s.auditId,expectedVersion:current.audit.version,title:'Name correction',range:s.period,findings:[{id:f.id,expectedVersion:f.version,category:'name_correction',sku,wording:f.wording,explanation:'Correct the displayed name.',patch:{name:'Test elbow corrected'},evidence:f.evidence}]});
 const applied:any=await decideCatalogReview(pool,p,{operationId:id(),auditId:s.auditId,findingId:s.findingId,findingVersion:2,decision:'approve'});assert.equal((await pool.query('SELECT name FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0].name,'Test elbow corrected');
 await undoCatalogAudit(pool,p,{operationId:id(),auditId:s.auditId,eventIds:applied.events.map((e:any)=>e.id)});assert.equal((await pool.query('SELECT name FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,sku])).rows[0].name,before);
}));

test('review card endpoint is owner scoped and developer issues are local-only',()=>fixture(async pool=>{
 const s=await suggestion(pool);const owner={hostname:'owner.example.test',issuer:'https://fixture.cloudflareaccess.com',audience:'offline_fixture_audience',email:'owner@example.test',storeId:fixtureStore};
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/rsi-test-media',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}));
 try{
  const headers={host:owner.hostname,'cf-access-jwt-assertion':'offline-owner',origin:'https://'+owner.hostname,'x-shopbot-owner':'1'};
  const body={operationId:id(),auditId:s.auditId,findingId:s.findingId,findingVersion:1,decision:'approve'};
  const denied=await app.inject({method:'POST',url:'/api/owner/catalog/ai-review/decision',headers:{...headers,origin:'https://other.example'},payload:body});assert.equal(denied.statusCode,403);
  const saved=await app.inject({method:'POST',url:'/api/owner/catalog/ai-review/decision',headers,payload:body});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().decision,'applied');
  const publicIssue=await app.inject({method:'GET',url:'/internal/developer/issues',headers});assert.equal(publicIssue.statusCode,404);
  const forwarded=await app.inject({method:'GET',url:'/internal/developer/issues',headers:{host:'localhost:3017','x-forwarded-for':'203.0.113.1'}});assert.equal(forwarded.statusCode,404);
  const localIssue=await app.inject({method:'GET',url:'/internal/developer/issues',headers:{host:'localhost:3017'}});assert.equal(localIssue.statusCode,200);assert.match(localIssue.body,/Developer issues/);
 }finally{await app.close();}
}));

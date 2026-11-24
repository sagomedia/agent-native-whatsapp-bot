import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {createApp} from '../apps/server/src/http/app.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {MockInterpreter} from '../apps/server/src/adapters/mock-interpreter.js';
import {initialQuoteLines} from '../packages/contracts/owner-quote.js';
import {fixtureStore} from '../profiles/hardware.js';
const owner={hostname:'owner.example.test',issuer:'https://test.cloudflareaccess.com',audience:'offline',email:'owner@example.test',storeId:fixtureStore};
const headers={host:owner.hostname,'cf-access-jwt-assertion':'offline',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
async function fixture(run:(f:any)=>Promise<void>){
 const schema='workbench_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});const apps:any[]=[];
 try{await setupDatabase(pool,'mock');const inbox=new SimulatorService(pool),runtime=new ConversationRuntime(pool,new MockInterpreter(),{partialReviews:true});
 const turn=async(event:any)=>{await inbox.ingest(typeof event==='string'?{id:randomUUID(),type:'text',text:event}:event);assert.equal(await runtime.processNext(simulatorContext),true);return inbox.snapshot();};
 let s=await turn('add one unicorn bolt');s=await turn({id:randomUUID(),type:'review_partial',expectedVersion:s.conversation.version});assert.equal(s.conversation.pending?.kind,'review');await turn({id:randomUUID(),type:'confirm',reviewId:s.conversation.pending!.id});
 const request=(await pool.query('SELECT * FROM order_requests')).rows[0];
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/offline-workbench',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline'}));apps.push(app);
 const post=(path:string,payload:object)=>app.inject({method:'POST',url:'/api/owner/'+path,headers,payload});
 const get=(path:string)=>app.inject({url:'/api/owner/'+path,headers});
 await run({pool,app,post,get,request,turn,apps});
 }finally{for(const a of apps)await a.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
function draft(request:any){return{expectedVersion:0,expectedRevision:request.effective_revision,lines:initialQuoteLines(request.lines)};}
function quote(request:any,saved:any,extra={}){return{id:randomUUID(),expectedRevision:request.effective_revision,draftVersion:saved.version,notify:false,lines:request.lines.map((l:any)=>({id:l.id,name:l.name,quantity:l.quantity??1,unit:l.unit??'piece',pricePaise:2500,manualConfirmed:true,reviewed:true,...extra}))};}
test('incomplete quote drafts survive a new owner read; saves are repeatable, versioned and have no commerce side effects',()=>fixture(async({pool,request,post,get}:any)=>{
 const path='requests/'+request.id+'/quote-draft',input=draft(request);input.lines[0].price='';input.lines[0].quantity='';
 assert.equal((await get(path)).json().draft,null);
 const saved=await post(path,input);assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().draft.version,1);
 const read=await get(path);assert.deepEqual(read.json().draft.lines,input.lines);
 assert.equal((await post(path,input)).statusCode,200,'An identical retry after a lost response is safe');
 const changed={...input,lines:input.lines.map(l=>({...l,price:'25.00',quantity:'1'}))};assert.equal((await post(path,changed)).statusCode,409,'An older window cannot overwrite the saved draft');
 const next=await post(path,{...changed,expectedVersion:1});assert.equal(next.statusCode,200,next.body);assert.equal(next.json().draft.version,2);
 const row=(await pool.query('SELECT * FROM order_requests')).rows[0];assert.deepEqual(row.lines,request.lines);assert.equal(row.effective_lines,null);assert.equal(row.effective_revision,1);assert.equal(row.acceptance,'awaiting_approval');
 for(const table of ['order_quotes','inventory_reservations','inventory_movements','whatsapp_outbox'])assert.equal((await pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0,table);
 assert.equal((await get('requests/'+request.id+'/quote-draft')).headers['cache-control'],'private, no-store');
}));
test('draft endpoints enforce authentication, origin, store isolation, line membership and current order revisions',()=>fixture(async({pool,app,post,get,request,apps}:any)=>{
 const path='requests/'+request.id+'/quote-draft',input=draft(request);
 assert.equal((await app.inject({url:'/api/owner/'+path})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/api/owner/'+path,headers:{...headers,origin:'https://foreign.test'},payload:input})).statusCode,403);
 assert.equal((await post(path,{...input,lines:[{...input.lines[0],id:randomUUID()}]})).statusCode,409);
 const foreign=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other shop','true')",[foreign]);
 const other=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/offline-workbench-other',owner:{...owner,storeId:foreign}},pool,undefined,undefined,async()=>({email:owner.email,subject:'other'}));apps.push(other);
 assert.equal((await other.inject({url:'/api/owner/'+path,headers})).statusCode,404);
 assert.equal((await other.inject({method:'POST',url:'/api/owner/'+path,headers,payload:input})).statusCode,409);
 await pool.query('UPDATE order_requests SET effective_revision=2 WHERE id=$1',[request.id]);assert.equal((await post(path,input)).statusCode,409);
 await pool.query("UPDATE order_requests SET acceptance='rejected' WHERE id=$1",[request.id]);assert.equal((await post(path,{...input,expectedRevision:2})).statusCode,409);
 assert.equal((await get(path)).json().draft,null);
}));
test('offering a matched catalog quote preserves the requested phrase and requires customer consent before applying it',()=>fixture(async({pool,post,get,request,turn}:any)=>{
 const path='requests/'+request.id,product=(await get('catalog?q=PTFE&visibility=visible&limit=8')).json().products[0];assert.ok(product);
 const input=draft(request);Object.assign(input.lines[0],{sku:product.sku,productVersion:product.version,name:product.name,unit:product.unit,quantity:'2',price:(product.pricePaise/100).toFixed(2),reviewed:true});
 const saved=(await post(path+'/quote-draft',input)).json().draft;
 const body={id:randomUUID(),draftVersion:saved.version,expectedRevision:1,notify:false,lines:[{id:request.lines[0].id,sku:product.sku,productVersion:product.version,name:product.name,unit:product.unit,quantity:2,pricePaise:product.pricePaise,reviewed:true}]};
 const offered=await post(path+'/quote',body);assert.equal(offered.statusCode,200,offered.body);assert.equal(offered.json().customerNotification,'not_requested');
 assert.equal((await post(path+'/quote',body)).statusCode,200,'The same send attempt is idempotent');
 assert.equal((await get(path+'/quote-draft')).json().draft,null);
 const before=(await pool.query('SELECT * FROM order_requests')).rows[0];assert.equal(before.effective_lines,null);assert.equal(before.effective_revision,1);assert.deepEqual(before.lines,request.lines);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_reservations')).rows[0].n,0);
 const stored=(await pool.query('SELECT * FROM order_quotes')).rows[0];assert.equal(stored.lines[0].sku,product.sku);assert.equal(stored.lines[0].query,request.lines[0].query);assert.equal(stored.lines[0].quantity,2);
 const snapshot=(await get('snapshot?details=0')).json();assert.deepEqual(snapshot.requests[0].original_lines,request.lines);assert.equal(snapshot.quotes[0].lines[0].sku,product.sku);
 const {orderQuoteReply}=await import('../apps/server/src/services/order-quotes.js');const c=await pool.connect();let rich;try{rich=await orderQuoteReply(c,fixtureStore,stored.id);}finally{c.release();}
 await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) VALUES($1,$2,'outbound',$3,'sent',$4::jsonb)",[randomUUID(),request.conversation_id,rich.text,JSON.stringify(rich)]);
 await turn(rich.buttons![0].event);
 const after=(await pool.query('SELECT * FROM order_requests')).rows[0];assert.equal(after.effective_revision,2);assert.equal(after.effective_lines[0].sku,product.sku);assert.equal(after.effective_lines[0].quantity,2);assert.deepEqual(after.lines,request.lines);assert.equal(after.acceptance,'awaiting_approval');
}));
test('catalog matches reject stale/foreign SKUs, wrong units and invalid increments; send requires the saved draft version and resolved manual items',()=>fixture(async({pool,post,get,request}:any)=>{
 const path='requests/'+request.id,product=(await get('catalog?q=PTFE&visibility=visible&limit=8')).json().products[0];const saved=(await post(path+'/quote-draft',draft(request))).json().draft;
 const attempt=(extra:object)=>post(path+'/quote',quote(request,saved,extra));
 assert.equal((await attempt({manualConfirmed:false})).statusCode,409);
 assert.equal((await attempt({sku:'FOREIGN',productVersion:1})).statusCode,409);
 assert.equal((await attempt({sku:product.sku,productVersion:product.version+1,name:product.name,unit:product.unit})).statusCode,409);
 assert.equal((await attempt({sku:product.sku,productVersion:product.version,name:product.name,unit:'kg'})).statusCode,409);
 await pool.query('UPDATE products SET quantity_step=2 WHERE store_id=$1 AND sku=$2',[fixtureStore,product.sku]);
 assert.equal((await attempt({sku:product.sku,productVersion:product.version,name:product.name,unit:product.unit,quantity:1})).statusCode,409);
 const updated=await post(path+'/quote-draft',{...draft(request),expectedVersion:1});assert.equal(updated.statusCode,200,updated.body);
 assert.equal((await attempt({})).statusCode,409,'Stale browser send cannot bypass a newer saved draft');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_quotes')).rows[0].n,0);
}));
test('sending a complete store-item quote confirms its details without a catalog match or separate review checkbox',()=>fixture(async({pool,post,request}:any)=>{
 const path='requests/'+request.id,saved=(await post(path+'/quote-draft',draft(request))).json().draft;
 const response=await post(path+'/quote',quote(request,saved,{manualConfirmed:true,reviewed:false}));
 assert.equal(response.statusCode,200,response.body);
 const row=(await pool.query('SELECT * FROM order_quotes')).rows[0];
 assert.equal(row.lines[0].sku,undefined);assert.equal(row.lines[0].merchantConfirmed.actor,owner.email);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_reservations')).rows[0].n,0);
 const order=(await pool.query('SELECT * FROM order_requests')).rows[0];
 assert.equal(order.effective_lines,null);assert.equal(order.acceptance,'awaiting_approval');
}));
test('current offered quotes protect drafts; expired quotes can be reviewed and replaced',()=>fixture(async({pool,post,request}:any)=>{
 const path='requests/'+request.id,saved=(await post(path+'/quote-draft',draft(request))).json().draft;
 const first=await post(path+'/quote',quote(request,saved));assert.equal(first.statusCode,200,first.body);
 assert.equal((await post(path+'/quote-draft',draft(request))).statusCode,409);
 await pool.query("UPDATE order_quotes SET created_at=now()-interval '25 hours'");
 const next=await post(path+'/quote-draft',draft(request));assert.equal(next.statusCode,200,next.body);
 const replacement=await post(path+'/quote',quote(request,next.json().draft));assert.equal(replacement.statusCode,200,replacement.body);
 assert.deepEqual((await pool.query('SELECT state FROM order_quotes ORDER BY created_at')).rows.map((r:any)=>r.state),['superseded','offered']);
}));
test('a customer amendment blocks the earlier draft and only its current confirmed list can be quoted',()=>fixture(async({pool,post,request}:any)=>{
 const path='requests/'+request.id+'/quote-draft',input=draft(request),saved=(await post(path,input)).json().draft;
 const message=randomUUID(),amendment=randomUUID(),proposed=[{...request.lines[0],id:randomUUID(),name:'Customer proposed replacement',query:'Customer proposed replacement',quantity:2}];
 await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status) VALUES($1,$2,'inbound','Change this item','processed')",[message,request.conversation_id]);
 await pool.query("INSERT INTO order_amendments(id,store_id,request_id,conversation_id,source_message_id,source_version,expected_revision,operations,proposed_lines,known_subtotal_paise,estimate_complete,summary) VALUES($1,$2,$3,$4,$5,1,1,'[]',$6::jsonb,0,false,'Customer proposed replacement')",[amendment,fixtureStore,request.id,request.conversation_id,message,JSON.stringify(proposed)]);
 assert.equal((await post(path,{...input,expectedVersion:saved.version})).statusCode,409);
 assert.equal((await post(path,{...input,expectedVersion:saved.version,amendmentId:amendment,lines:initialQuoteLines(proposed)})).statusCode,409,'An unconfirmed customer proposal cannot be quoted');
 await pool.query("UPDATE order_amendments SET state='owner_pending' WHERE id=$1",[amendment]);
 assert.equal((await post(path,{...input,expectedVersion:saved.version,amendmentId:amendment})).statusCode,409,'The original line IDs cannot replace the amendment list');
 const result=await post(path,{...input,expectedVersion:saved.version,amendmentId:amendment,lines:initialQuoteLines(proposed)});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().draft.amendmentId,amendment);
 await pool.query("UPDATE order_amendments SET state='withdrawn' WHERE id=$1",[amendment]);
 assert.equal((await post(path,{...input,expectedVersion:result.json().draft.version,amendmentId:amendment,lines:initialQuoteLines(proposed)})).statusCode,409);
}));
test('sending a saved quote requires its current identity, revision, notification choice and unexpired customer approval',()=>fixture(async({pool,post,request}:any)=>{
 const path='requests/'+request.id,saved=(await post(path+'/quote-draft',draft(request))).json().draft;
 const offered=await post(path+'/quote',quote(request,saved));assert.equal(offered.statusCode,200,offered.body);const id=offered.json().quoteId;
 const payload={quoteId:id,expectedRevision:1,notify:true};
 assert.equal((await post(path+'/quote/notify',{...payload,notify:false})).statusCode,400);
 assert.equal((await post(path+'/quote/notify',{...payload,quoteId:randomUUID()})).statusCode,409);
 assert.equal((await post(path+'/quote/notify',{...payload,expectedRevision:2})).statusCode,409);
 const notice=await post(path+'/quote/notify',payload);assert.equal(notice.statusCode,200,notice.body);assert.equal(notice.json().customerNotification,'not_sent');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_quotes')).rows[0].n,1,'Notification does not mint another quote');
 assert.equal((await pool.query('SELECT effective_revision FROM order_requests')).rows[0].effective_revision,1,'Notification is not customer approval');
 await pool.query("UPDATE order_quotes SET created_at=now()-interval '25 hours'");assert.equal((await post(path+'/quote/notify',payload)).statusCode,409);
}));

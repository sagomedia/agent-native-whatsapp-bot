import {productName} from '../packages/contracts/language.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {renderWhatsAppReply,fitText,productMediaUrl,cardText} from '../apps/server/src/services/whatsapp-reply.js';
import {planWhatsAppReply} from '../apps/server/src/services/whatsapp-plan.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';
import {fixtureStore} from '../profiles/hardware.js';
import {WhatsAppChannel,webhookSchema} from '../apps/server/src/services/whatsapp-channel.js';
import {createApp} from '../apps/server/src/http/app.js';
import type {RichReply,SimulatorEvent,Product} from '../packages/contracts/index.js';
import type {WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
const cfg:WhatsAppConfig={hostname:'shopbot-api.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'offline-test-secret',verifyToken:'offline-test-verification',accessToken:'offline-test-api-token-not-a-real-credential',graphVersion:'v25.0',recipients:['919000000001','919000000002'],defaultReplyLanguage:'en',processEnabled:true,sendEnabled:true};
const product=(n:number):Product=>({sku:'H'+String(n).padStart(2,'0'),name:'Pipe '+n,unit:'piece',pricePaise:12500,stock:null,version:1,aliases:[],quantityStep:1,imageUrl:`/demo-images/H${String(n).padStart(2,'0')}.jpg`});
const reply=(count:number):RichReply=>({version:1,kind:'product_choices',text:'Choose the pipe you need.',presentation:'carousel_preview',outboundMessages:1,cards:Array.from({length:count},(_,i)=>({product:product(i+1),label:'Choose this',action:{id:randomUUID(),type:'choose_product',sku:product(i+1).sku,expectedVersion:0}}))});
test('long customer requests cannot hide the photo identity or relevance warning',()=>{
 const rich=reply(2),card=rich.cards![0];
 card.product.name='Premium 4 inch cutting wheel';
 card.requestLabel='Requested: cutting plier '.repeat(20);
 card.matchLabel='Related item; check suitability';
 card.quantityLabel='Requested: 100 pieces '.repeat(10);
 const caption=cardText(card,rich);
 assert.ok(caption.startsWith(card.product.name));
 assert.ok(caption.includes(card.matchLabel));
 assert.ok(caption.includes('₹125.00'));
 assert.ok(Array.from(caption).length<=160);
});
test('two through ten choices use one native carousel with bounded consistent quick replies',()=>{
 for(const count of [2,3,10]){
  const result=renderWhatsAppReply(reply(count),randomUUID(),cfg.hostname),payload=result.payload as any;
  assert.equal(result.format,'carousel');assert.equal(payload.type,'interactive');assert.equal(payload.interactive.type,'carousel');
  assert.equal(payload.interactive.header,undefined);assert.equal(payload.interactive.action.buttons,undefined);
  assert.equal(payload.interactive.action.cards.length,count);assert.equal(new Set(result.actions.map(a=>a.id)).size,count);
  for(const [index,card] of payload.interactive.action.cards.entries()){
   assert.equal(card.card_index,index);assert.equal(card.type,'cta_url');assert.equal(card.header.type,'image');
   assert.equal(card.action.buttons[0].type,'quick_reply');assert.ok(Array.from(card.body.text).length<=160);assert.ok(card.body.text.includes('₹125.00'));
   assert.ok(card.header.image.link.startsWith('https://'+cfg.hostname+'/catalog-images/'));assert.ok(card.action.buttons[0].quick_reply.id.length<=20);
  }
 }
 assert.throws(()=>renderWhatsAppReply(reply(11),randomUUID(),cfg.hostname),/at most ten/);
});
test('ambiguous proposal cards never duplicate Start this list buttons and preserve consistent carousel rows',()=>{
 for(const count of [1,4]){
  const rich=reply(count),start={label:'Start this list',event:{id:randomUUID(),type:'shopping_action' as const,action:'new_list' as const,expectedVersion:0}},handoff={label:'Talk to shop',event:{id:randomUUID(),type:'shopping_action' as const,action:'handoff' as const,expectedVersion:0}};
  rich.buttons=[start,handoff];rich.cards![0]={...rich.cards![0],label:start.label,action:start.event};
  const rendered=renderWhatsAppReply(rich,randomUUID(),cfg.hostname),payload=rendered.payload as any;
  const rows=count===1?[payload.interactive.action.buttons.map((b:any)=>b.reply)]:payload.interactive.action.cards.map((c:any)=>c.action.buttons.map((b:any)=>b.quick_reply));
  assert.deepEqual(rows[0].map((b:any)=>b.title),['Start this list','Talk to shop']);
  assert.equal(new Set(rows.map((r:any[])=>r.length)).size,1);assert.ok(rows.every((r:any[])=>new Set(r.map(b=>b.title)).size===r.length));
  assert.ok(rendered.actions.some(a=>a.event.id===start.event.id));assert.ok(rendered.actions.some(a=>a.event.id===handoff.event.id));
 }
});
test('single choices retain photo and tap, absent photos use lists, and four menu items never overflow reply buttons',()=>{
 const one=renderWhatsAppReply(reply(1),randomUUID(),cfg.hostname).payload as any;
 assert.equal(one.interactive.type,'button');assert.equal(one.interactive.header.type,'image');
 const missing=reply(3);missing.cards![0].product.imageUrl=undefined;
 const list=renderWhatsAppReply(missing,randomUUID(),cfg.hostname).payload as any;
 assert.equal(list.interactive.type,'list');assert.equal(list.interactive.action.sections[0].rows.length,3);
 const menu:RichReply={version:1,kind:'text',text:'Pick a category',presentation:'text',outboundMessages:1,buttons:Array.from({length:4},(_,i)=>({label:'Category '+i,event:{id:randomUUID(),type:'browse',query:'department-'+i,expectedVersion:0}}))};
 assert.equal((renderWhatsAppReply(menu,randomUUID(),cfg.hostname).payload as any).interactive.type,'list');
 const review=reply(2);review.kind='order_review';review.cards=review.cards!.map(c=>({...c,action:undefined,product:{...c.product,imageUrl:undefined}}));review.buttons=[{label:'Confirm request',event:{id:randomUUID(),type:'confirm',reviewId:randomUUID()}},{label:'Edit list',event:{id:randomUUID(),type:'text',text:'edit my list'}}];
 assert.equal((renderWhatsAppReply(review,randomUUID(),cfg.hostname).payload as any).interactive.type,'button');
 assert.equal(productMediaUrl('/customer-uploads/private.jpg',cfg.hostname),undefined);
 assert.equal(productMediaUrl('http://insecure.example/photo.jpg',cfg.hostname),undefined);
});
test('Tamil clipping preserves graphemes and price, and confirmation requires the complete review',()=>{
 const text='தமிழ் பொருள் அளவு '.repeat(20),clipped=fitText(text,20);
 assert.ok(Array.from(clipped).length<=20);assert.equal(clipped.endsWith('…'),true);
 const segments=[...new Intl.Segmenter('ta',{granularity:'grapheme'}).segment(text)].map(s=>s.segment);
 assert.ok(segments.join('').startsWith(clipped.slice(0,-1)));
 const rich=reply(2);rich.replyLanguage='ta';rich.cards![0].product.localNames={ta:text};
 assert.ok(((renderWhatsAppReply(rich,randomUUID(),cfg.hostname).payload as any).interactive.action.cards[0].body.text).includes('₹125.00'));
 assert.throws(()=>renderWhatsAppReply({...rich,kind:'order_review',text:'x'.repeat(1025)},randomUUID(),cfg.hostname),/in full/);
});
test('service-window visual choices take priority over marketing templates and closed windows remain blocked',()=>{
 const caps={serviceWindowOpen:true,catalogConnected:true,serviceRatePaise:10,maxPaisePerTurn:50,allowMarketingCarousel:false,approvedCarousels:[]};
 assert.equal(planWhatsAppReply(reply(3),caps).format,'media_carousel');
 assert.equal(planWhatsAppReply(reply(1),caps).format,'image_buttons');
 assert.equal(planWhatsAppReply(reply(3),{...caps,serviceWindowOpen:false}).format,'blocked');
 assert.equal(planWhatsAppReply(reply(11),caps).format,'blocked');
});
async function fixture(run:(pool:pg.Pool,channel:WhatsAppChannel,sent:any[])=>Promise<void>){
 const schema='wa_visual_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),sent:any[]=[];
 try{await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);
  const channel=new WhatsAppChannel(pool,cfg,async(_url,init)=>{sent.push(JSON.parse(String(init!.body)));return new Response(JSON.stringify({messages:[{id:'wamid.out.'+sent.length}]}),{status:200});});await channel.setup();await run(pool,channel,sent);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
const inbound=(message:object,from=cfg.recipients[0])=>webhookSchema.parse({object:'whatsapp_business_account',entry:[{id:cfg.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},messages:[{id:'wamid.'+randomUUID(),from,timestamp:String(Math.floor(Date.now()/1000)),...message}]}}]}]});
async function turn(channel:WhatsAppChannel,body:object,from?:string){await channel.receive(inbound(body,from));await channel.processNext();await channel.sendNext();}
async function action(pool:pg.Pool,type:SimulatorEvent['type'],sku?:string){return (await pool.query(`SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE a.event->>'type'=$1 AND ($2::text IS NULL OR a.event->>'sku'=$2) ORDER BY o.created_at DESC LIMIT 1`,[type,sku??null])).rows[0];}
const tap=(a:any)=>({type:'interactive',context:{id:a.provider_id},interactive:{type:'button_reply',button_reply:{id:a.id,title:'Untrusted customer supplied title'}}});
const carouselTap=(a:any)=>({type:'button',context:{id:a.provider_id},button:{payload:a.id,text:'Untrusted customer supplied title'}});
test('category → photo → quantity → review → confirm runs without inference, and duplicate confirmation cannot submit twice',async()=>fixture(async(pool,channel,sent)=>{
 await turn(channel,{type:'text',text:{body:'hello'}});
 assert.equal(sent[0].type,'interactive');
 const start=(await pool.query(`SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE a.event->>'action'='browse'`)).rows[0];assert.ok(start);await turn(channel,tap(start));
 const category=(await pool.query(`SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE a.event->>'query'='plumbing'`)).rows[0];
 assert.ok(category,'Expected real plumbing department menu');await turn(channel,tap(category));
 assert.equal(sent.at(-1).interactive.type,'carousel');
 const choose=await action(pool,'choose_product');assert.ok(choose);await turn(channel,carouselTap(choose));
 let state=(await pool.query('SELECT draft,pending FROM conversations WHERE id=$1',[choose.conversation_id])).rows[0];
 assert.equal(state.draft[0].quantity,null);assert.equal(state.pending.kind,'question');
 const quantity=await action(pool,'set_quantity');assert.ok(quantity);await turn(channel,tap(quantity));
 state=(await pool.query('SELECT draft,pending FROM conversations WHERE id=$1',[choose.conversation_id])).rows[0];
 assert.equal(state.pending.kind,'review');assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,0);
 const confirm=await action(pool,'confirm');assert.ok(confirm);const callback=inbound(tap(confirm));
 await channel.receive(callback);await channel.processNext();await channel.sendNext();await channel.receive(callback);await channel.processNext();
 assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,1);assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,0);
 assert.equal((await pool.query('SELECT acceptance FROM order_requests')).rows[0].acceptance,'awaiting_approval');
}));
test('cross-customer, unsent, expired and forged taps cannot change a draft or invoke AI',async()=>fixture(async(pool,channel)=>{
 await turn(channel,{type:'text',text:{body:'hello'}});const browse=await action(pool,'shopping_action');assert.ok(browse);
 await turn(channel,tap(browse),cfg.recipients[1]);assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,0);
 assert.equal((await pool.query("SELECT * FROM conversations WHERE draft<>'[]'::jsonb")).rowCount,0);
 await pool.query("UPDATE whatsapp_outbox SET state='queued' WHERE message_id=$1",[browse.message_id]);await channel.receive(inbound(tap(browse)));assert.equal(await channel.processNext(),false);
 await pool.query("UPDATE whatsapp_outbox SET state='accepted' WHERE message_id=$1",[browse.message_id]);await pool.query("UPDATE whatsapp_actions SET expires_at=now()-interval '1 second' WHERE id=$1",[browse.id]);
 await channel.receive(inbound(tap(browse)));assert.equal(await channel.processNext(),false);
 await channel.receive(inbound(tap({...browse,id:'forged'})));assert.equal(await channel.processNext(),false);
 assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,0);
}));
test('a multi-item request keeps quantities and accepts identified products together before separate final consent',async()=>fixture(async(pool,channel,sent)=>{
 await turn(channel,{type:'text',text:{body:'2 H01 and 1 H07'}});
 let row=(await pool.query('SELECT draft,pending FROM conversations WHERE id IN (SELECT conversation_id FROM whatsapp_conversations)')).rows[0];
 assert.equal(row.pending.kind,'products');assert.deepEqual(row.draft.map((l:any)=>l.quantity),[2,1]);
 assert.equal(sent.at(-1).interactive.type,'carousel');
 const bulk=await action(pool,'confirm_products');assert.ok(bulk,JSON.stringify(sent.at(-1)));assert.ok(sent.at(-1).interactive.action.cards.every((c:any)=>c.action.buttons.length===2));
 await turn(channel,carouselTap(bulk));row=(await pool.query('SELECT draft,pending FROM conversations WHERE id=$1',[bulk.conversation_id])).rows[0];
 assert.equal(row.pending.kind,'review');assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,0);
 const confirm=await action(pool,'confirm');assert.ok(confirm);await turn(channel,carouselTap(confirm));
 assert.deepEqual((await pool.query('SELECT lines FROM order_requests')).rows[0].lines.map((l:any)=>l.quantity),[2,1]);
 assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,1);
 const stale=await action(pool,'confirm_products');await channel.receive(inbound(tap(stale)));assert.equal(await channel.processNext(),false);
 assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,1);
}));
test('only active catalog photos belonging to the sender store are public',async()=>fixture(async(pool,channel)=>{
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/test',whatsapp:cfg},pool,undefined,undefined,undefined,channel);
 try{
  assert.equal((await app.inject({url:'/catalog-images/H01.jpg',headers:{host:cfg.hostname}})).statusCode,200);
  await pool.query('UPDATE products SET active=false WHERE store_id=$1 AND sku=$2',[fixtureStore,'H01']);
  assert.equal((await app.inject({url:'/catalog-images/H01.jpg',headers:{host:cfg.hostname}})).statusCode,404);
  assert.equal((await app.inject({url:'/catalog-images/H99.jpg',headers:{host:cfg.hostname}})).statusCode,404);
  assert.equal((await app.inject({url:'/catalog-images/H02.jpg',headers:{host:'other.example.test'}})).statusCode,404);
  assert.equal((await app.inject({url:'/customer-uploads/private.jpg',headers:{host:cfg.hostname}})).statusCode,404);
 }finally{await app.close();}
}));
test('an oversized review preserves the draft but invalidates undisplayed consent',async()=>fixture(async(pool,channel,sent)=>{
 const skus=['H07','H08','H09','H10','H11','H12','H20','H21','H23'];
 for(const sku of skus)await pool.query('UPDATE products SET name=$1 WHERE store_id=$2 AND sku=$3',[sku+' '+('Long catalog title '.repeat(5)),fixtureStore,sku]);
 await turn(channel,{type:'text',text:{body:skus.map(sku=>'1 '+sku).join(' and ')}});
 let bulk;
 for(let n=0;n<3;n++){bulk=await action(pool,'confirm_products');assert.ok(bulk,JSON.stringify(sent.at(-1)));await turn(channel,tap(bulk));}
 const state=(await pool.query('SELECT pending,draft FROM conversations WHERE id=$1',[bulk.conversation_id])).rows[0];
 assert.equal(state.pending,null);assert.equal(state.draft.length,9);assert.equal(sent.at(-1).type,'text');
 assert.match(sent.at(-1).text.body,/too many details/);assert.equal((await pool.query("SELECT 1 FROM whatsapp_actions WHERE event->>'type'='confirm'")).rowCount,0);
 await turn(channel,{type:'text',text:{body:'yes'}});assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,0);
}));


test('reference photos preserve localized labels, product identity, pending price and actions in legacy and ordered visual replies',()=>{
 for(const [language,label,pending] of [['en','Reference photo','Price: shop to confirm'],['ta','Reference படம்','கடையில் சரிபார்த்து சொல்லப்படும்'],['ta-Latn','Reference photo','Vilai: kadai sollanum']] as const){
  const rich={...reply(2),replyLanguage:language,text:'Request context '.repeat(140)};
  for(const card of rich.cards!){card.product={...card.product,name:'Premium 4 inch cutting wheel',imageUrl:'/catalog-images/reference/'+randomUUID()+'.jpg',imageReference:true,pricePaise:0,priceStatus:'confirm'};card.requestLabel='Requested product '.repeat(30);card.detailLabel='Related item '.repeat(30);}
  const legacy=renderWhatsAppReply(rich,randomUUID(),cfg.hostname);
  assert.equal(legacy.format,'carousel');assert.equal(legacy.actions.length,2);
  const legacyCards=(legacy.payload as any).interactive.action.cards;
  for(const card of legacyCards){assert.ok(card.body.text.includes(productName(rich.cards![0].product,language)));assert.ok(card.body.text.endsWith(label));assert.ok(card.body.text.includes(pending));assert.ok(!card.body.text.includes('₹0'));assert.ok(Array.from(card.body.text).length<=160);assert.ok(card.header.image.link.includes('/catalog-images/reference/'));}
  const parts=rich.cards!.map(c=>({kind:'product' as const,product:c.product,caption:'Premium 4 inch cutting wheel\n'+pending+'\n'+'Extra detail '.repeat(80),buttons:[{label:c.label,event:c.action!}]}));
  const ordered={...rich,cards:undefined,parts:[{id:randomUUID(),text:rich.text,cards:parts}]};
  const carousel=renderWhatsAppReply(ordered,randomUUID(),cfg.hostname);
  assert.equal(carousel.format,'carousel');assert.equal(carousel.actions.length,2);
  for(const card of (carousel.payload as any).interactive.action.cards){assert.ok(card.body.text.startsWith('Premium 4 inch cutting wheel'));assert.ok(card.body.text.includes(pending));assert.ok(card.body.text.endsWith(label));assert.ok(Array.from(card.body.text).length<=160);}
  for(const single of [{...rich,cards:rich.cards!.slice(0,1)},{...ordered,parts:[{...ordered.parts[0],cards:parts.slice(0,1)}]}]){
   const result=renderWhatsAppReply(single,randomUUID(),cfg.hostname),body=(result.payload as any).interactive.body.text;
   assert.equal(result.format,'buttons');assert.ok(body.includes(single.parts?'Premium 4 inch cutting wheel':productName(rich.cards![0].product,language)));assert.ok(body.includes(pending));assert.ok(body.endsWith(label));assert.ok(Array.from(body).length<=1024);assert.equal(result.actions.length,1);
  }
 }
});

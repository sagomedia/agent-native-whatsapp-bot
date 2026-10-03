import {loadVoice} from '../services/voice-media.js';
import {priceInquiry,quantityReply} from '../services/shopping-language.js';
import {socialIntent,shopInquiry,presentReply,plainReply} from '../services/replies.js';
import {FreeQuotaError} from '../adapters/google-interpreter.js';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { interpretationSchema, type ConversationState, type Interpretation, type SimulatorEvent, type ToolCall, type Product, type RichReply } from '../../../../packages/contracts/index.js';
import type { Interpreter } from '../adapters/interpreter.js';
import {reserveAttempt,settleAttempt,validateRateCard,coolDownFreeQuota} from '../services/inference-budget.js';
import {getProducts,catalogEnabled,catalogContext,sameUnit} from '../services/catalog.js';
import {getCatalogMap,refinementPlan} from '../services/catalog-discovery.js';
import { loadState, RetailTools,digest, type ToolResult } from '../services/tools.js';
import { ToolError, withConversation, type ActorContext } from '../services/context.js';
import {loadAssistantMemory,saveAssistantMemory,observeCatalog,observationQueries,recheckQueries,isRecheck,pendingItem,assistanceReply,conversationBinding,type AssistantMemory,type CatalogObservation} from '../services/agent-assistance.js';

type Claimed = { id:string; token:string; event:SimulatorEvent; bindingId:string|null; state:ConversationState; catalog:Product[];catalogMap?:import('../../../../packages/contracts/index.js').CatalogMap;memory:AssistantMemory|null;displayedActions:SimulatorEvent[];displayedProducts:{event:SimulatorEvent;product:Product}[] };
export class ConversationRuntime {
  readonly tools:RetailTools;
  constructor(private pool:Pool,private provider:Interpreter,options:{allowPaidInference?:boolean;allowFreeInference?:boolean}={}) {
    if(provider.mode==='live') {
      if(!(provider.freeQuota?options.allowFreeInference:options.allowPaidInference)||!provider.billing) throw new ToolError('Live interpretation is disabled until explicitly authorized metered configuration is supplied');
      validateRateCard(provider.billing);
    }
    this.tools=new RetailTools(pool);
  }
  async processNext(ctx:ActorContext):Promise<boolean> {
    const claimed=await withConversation(this.pool,ctx,async client=>{
      const active=await client.query("SELECT id FROM messages WHERE conversation_id=$1 AND status='processing' AND lease_until>now() LIMIT 1",[ctx.conversationId]);
      if(active.rowCount) return null;
      const row=await client.query("SELECT id,payload,binding_id FROM messages WHERE conversation_id=$1 AND (status='pending' OR (status='processing' AND lease_until<=now())) ORDER BY sequence LIMIT 1 FOR UPDATE",[ctx.conversationId]);
      if(!row.rows[0]) return null;
      const token=randomUUID(),m=row.rows[0];
      await client.query("UPDATE messages SET status='processing',claim_token=$1,lease_until=now()+interval '30 seconds' WHERE id=$2",[token,m.id]);
      const shown=(await client.query("SELECT payload FROM messages WHERE conversation_id=$1 AND direction='outbound' ORDER BY sequence DESC LIMIT 20",[ctx.conversationId])).rows;
      const displayedProducts=shown.flatMap(r=>(r.payload?.cards??[]).flatMap((c:any)=>c.action&&c.product?[{event:c.action,product:c.product}]:[]));
      const displayedActions=shown.flatMap(r=>(r.payload?.cards??[]).flatMap((c:any)=>c.action?[c.action]:[]));
      return {id:m.id,token,event:m.payload,bindingId:m.binding_id,state:await loadState(client,ctx),catalog:await catalogEnabled(client,ctx)?await catalogContext(client,ctx):await getProducts(client,ctx),catalogMap:await catalogEnabled(client,ctx)?await getCatalogMap(client,ctx):undefined,memory:await loadAssistantMemory(client,ctx),displayedActions,displayedProducts} as Claimed;
    });
    if(!claimed) return false;
    let interpretation:Interpretation|undefined;
    let failure:string|undefined;
    let deterministic:ToolCall|undefined;
    try {deterministic=this.knownAction(claimed);} catch(error) {failure=error instanceof Error?error.message:'Invalid callback';}
    const quoteRecheck=claimed.event.type==='text'&&isRecheck(claimed.event.text)&&claimed.memory?.purpose==='quote'&&claimed.memory.sourceVersion===claimed.state.version;
    if(quoteRecheck)interpretation={operations:[],next:'price',priceQuery:claimed.memory!.queries[0],priceQuantity:claimed.memory!.quoteQuantity,priceUnit:claimed.memory!.quoteUnit};
    const social=claimed.event.type==='text'?socialIntent(claimed.event.text):undefined;
    const inquiry=claimed.event.type==='text'?shopInquiry(claimed.event.text):undefined;
    if(inquiry&&!deterministic)interpretation=inquiry;
    if(social&&!deterministic)interpretation={operations:[],next:'continue',conversation:social};
    if(!failure&&!deterministic&&!social&&!inquiry&&(claimed.event.type==='text'||claimed.event.type==='voice')) {
      try {interpretation=await this.interpret(ctx,claimed);}
      catch(error) {failure=this.provider.mode==='live'?(error instanceof ToolError&&error.code==='stale_version'?error.message:error instanceof ToolError&&error.code==='quota_unavailable'?'I’m temporarily at the AI request limit. Your list is kept. You can still say “check again”, use a product button, or review your list; please wait a little before sending a new description.':error instanceof FreeQuotaError?'The AI service is temporarily rate limited. Your list is kept; product buttons and catalog rechecks still work.':'I’m having trouble processing that message. Your list is kept. You can recheck the item, use the product choices, or try a new description shortly.'):error instanceof Error?error.message:'Interpretation failed. Your draft is retained.';}
    }
    await withConversation(this.pool,ctx,async client=>{
      const held=await client.query("SELECT id FROM messages WHERE id=$1 AND conversation_id=$2 AND status='processing' AND claim_token=$3",[claimed.id,ctx.conversationId,claimed.token]);
      if(!held.rowCount) return; // Another worker acquired the expired lease; old result is discarded.
      const current=await loadState(client,ctx);
      if(claimed.event.type==='voice'&&interpretation?.transcript)await client.query('UPDATE messages SET text=$1 WHERE id=$2 AND conversation_id=$3',[interpretation.transcript,claimed.id,ctx.conversationId]);
      let message=failure??'';let rich:RichReply=plainReply(message);
      // The savepoint ensures invalid dependent operations cannot partially mutate the draft.
      await client.query('SAVEPOINT turn_actions');
      try {
        if(!failure) {
          if(current.version!==claimed.state.version) throw new ToolError('The draft changed during interpretation. Please resend against the current draft.','stale_version');
          const selectedCatalogProduct=claimed.displayedProducts.find(p=>digest(p.event)===digest(claimed.event))?.product;
          const selectedCatalogSku=(claimed.event.type==='choose_product'||claimed.event.type==='select_candidate')&&claimed.displayedActions.some(action=>digest(action)===digest(claimed.event))?claimed.event.sku:undefined;
          const invoke=(call:ToolCall)=>this.tools.invokeInTransaction(client,{...ctx,...(call.name==='submit_order_request'&&deterministic?.name==='submit_order_request'?{consentReviewId:call.args.reviewId}:{}),...(call.name==='confirm_product_choices'&&deterministic?.name==='confirm_product_choices'?{consentProductBatchId:call.args.batchId}:{}),...(selectedCatalogSku?{selectedCatalogSku,selectedCatalogProduct}:{})},call,claimed.id);
          let result:ToolResult;
          let assistance:CatalogObservation[]|undefined;
          let assistanceLineId:string|undefined;let assistanceBindingId:string|undefined;
          const rechecking=claimed.event.type==='text'&&isRecheck(claimed.event.text);
          if(rechecking&&!quoteRecheck&&current.pending?.kind!=='products'||interpretation?.next==='assist') {
            const suggested=rechecking?recheckQueries(current,claimed.memory):interpretation!.assistance!.queries;
            const description=claimed.event.type==='text'?claimed.event.text:interpretation?.transcript??suggested[0];
            const queries=current.catalogDiscovery?(rechecking?[claimed.memory?.observations[0]?.query??suggested[0]]:[interpretation!.assistance!.rootQuery??observationQueries(description,current,claimed.memory)[0]]).filter(q=>!!q):suggested;
            const basePlan=rechecking?claimed.memory?.observations[0]?.discovery?.plan:interpretation?.assistance?.search;
            const search=current.catalogDiscovery?{...basePlan,keywords:[...new Set([...(basePlan?.keywords??[]),...suggested])].slice(0,8)}:undefined;
            assistanceLineId=rechecking?(claimed.memory?.sourceVersion===current.version?claimed.memory.lineId??undefined:pendingItem(current)?.id):interpretation!.assistance!.lineId;
            if(assistanceLineId&&pendingItem(current)?.id!==assistanceLineId&&!(current.pending?.kind==='products'&&current.pending.groups.some(g=>g.lineId===assistanceLineId)))throw new ToolError('That search refers to an earlier item. Please name the current item.','stale_question');
            assistance=await observeCatalog(client,ctx,this.tools,queries,`${claimed.id}:assist`,search);
            result={state:current,message:''};
            assistanceBindingId=await saveAssistantMemory(client,ctx,queries.length?{purpose:assistanceLineId?'pending':'discovery',queries,lineId:assistanceLineId??null,sourceVersion:current.version,observations:assistance}:null);
          } else if(deterministic) {
            result=await invoke(deterministic);
            if(deterministic.name==='confirm_product_choices'||deterministic.name==='apply_draft_changes'&&(current.requireProductConfirmation||claimed.event.type==='select_candidate'||claimed.event.type==='choose_product'||(claimed.event.type==='text'&&claimed.state.pending?.kind==='question'))) result=await invoke({name:'preview_order',args:{expectedVersion:result.state!.version}});
          }
          else if(interpretation) {
            if(interpretation.next==='price') result=await invoke({name:'search_products',args:{query:interpretation.priceQuery!,quantity:interpretation.priceQuantity,requestedUnit:interpretation.priceUnit}});
            else {
              let state=current;
              if(interpretation.operations.length) state=(await invoke({name:'apply_draft_changes',args:{expectedVersion:current.version,operations:interpretation.operations}})).state!;
              result=interpretation.next==='review'||state.requireProductConfirmation&&interpretation.operations.length?await invoke({name:'preview_order',args:{expectedVersion:state.version}}):{state,message:'Draft saved; request review when ready.'};
            }
          } else throw new ToolError('No permitted action found. Review the draft or send a clear shopping request.');
          if(assistance)rich=assistance.length?assistanceReply(assistance,current,interpretation?.assistance?.question,rechecking,assistanceLineId,assistanceBindingId):plainReply('Which item would you like me to check again? Tell me its name or what you need it for.');
          else {
            if(result.products) {
              const query=deterministic?.name==='search_products'||deterministic?.name==='discover_products'?deterministic.args.query:interpretation?.priceQuery;
              const quantity=deterministic?.name==='search_products'?deterministic.args.quantity:interpretation?.priceQuantity,unit=deterministic?.name==='search_products'?deterministic.args.requestedUnit:interpretation?.priceUnit;
              if(query)result.discoveryBindingId=await saveAssistantMemory(client,ctx,{purpose:!!result.discovery||claimed.event.type==='browse'||interpretation?.conversation==='browse'?'discovery':'quote',queries:[query],lineId:null,sourceVersion:current.version,quoteQuantity:quantity,quoteUnit:unit,observations:[{tool:result.discovery?'discover_products':'search_products',query,products:result.products,totalCount:result.totalCount??result.products.length,discovery:result.discovery}]});
            }
            rich=presentReply(result,result.state??current,interpretation,claimed.event);
            if(claimed.event.type==='text'&&claimed.event.text.trim().toLowerCase()==='yes'&&deterministic?.name==='get_draft'&&claimed.memory?.sourceVersion===current.version) {
              if(claimed.memory.purpose==='quote')rich=plainReply('That was a price check; nothing has been added. Use “Add to my list” or tell me which item and quantity you want.');
              else if(claimed.memory.observations.flatMap(o=>o.products).length>1)rich=plainReply('Which of the options would you like? Choose a product or tell me its name; I haven’t changed your list.');
            }
            if(result.state&&(interpretation?.operations.length||deterministic?.name==='apply_draft_changes'||deterministic?.name==='confirm_product_choices'||deterministic?.name==='preview_order')) {
              const line=pendingItem(result.state);
              if(line) {
                const queries=[line.query??line.name],observations=await observeCatalog(client,ctx,this.tools,queries,`${claimed.id}:remember`);
                await saveAssistantMemory(client,ctx,{purpose:'pending',queries,lineId:line.id,sourceVersion:result.state.version,observations});
              } else await saveAssistantMemory(client,ctx,null);
            }
          }
          message=rich.text;
        }
        await client.query('RELEASE SAVEPOINT turn_actions');
      } catch(error) {
        await client.query('ROLLBACK TO SAVEPOINT turn_actions');
        message=error instanceof Error?error.message:'Action failed. Your draft is retained.';rich=plainReply(message);
      }
      await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,response_to,payload) VALUES($1,$2,'outbound',$3,'sent',$4,$5::jsonb)",[randomUUID(),ctx.conversationId,message,claimed.id,JSON.stringify(rich)]);
      await client.query("UPDATE messages SET status='processed',claim_token=NULL,lease_until=NULL WHERE id=$1",[claimed.id]);
    });
    return true;
  }
  private knownAction(claim:Claimed):ToolCall|undefined {
    const e=claim.event,s=claim.state;
    if(e.type==='refine_discovery'){const memory=claim.memory,result=memory?.observations.find(o=>o.discovery)?.discovery;if(!memory||memory.id!==e.memoryId||memory.sourceVersion!==s.version||!result)throw new ToolError('That search question is no longer current.','stale_question');return {name:'discover_products',args:{query:result.query,search:refinementPlan(result,e.facet,e.value)}};}
    if(e.type==='refine_search'){const check=s.pending,group=check?.kind==='products'&&check.id===e.batchId&&check.version===s.version?check.groups.find(g=>g.lineId===e.lineId):undefined;if(!group?.discovery)throw new ToolError('That category or brand question is no longer current.','stale_question');const line=s.draft.find(l=>l.id===e.lineId)!;return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:e.lineId,query:line.query??line.name,search:refinementPlan(group.discovery,e.facet,e.value)}]}};}
    if(e.type==='select_product'||e.type==='confirm_products') {
      const pending=s.pending;
      if(pending?.kind!=='products'||pending.id!==e.batchId||pending.version!==s.version)throw new ToolError('That product check is no longer current. Review your list again.','stale_confirmation');
      if(e.type==='confirm_products'&&pending.groups.some(g=>g.products.length!==1&&!(s.catalogDiscovery&&s.draft.some(l=>l.id===g.lineId&&g.products.some(p=>p.sku===l.sku)))))throw new ToolError('Choose the correct option for each requested item first.');
      return {name:'confirm_product_choices',args:{batchId:e.batchId,choices:e.type==='select_product'?[{lineId:e.lineId,sku:e.sku}]:pending.groups.map(g=>({lineId:g.lineId,sku:s.catalogDiscovery?s.draft.find(l=>l.id===g.lineId)?.sku??g.products[0].sku:g.products[0].sku}))}};
    }
    if(e.type==='browse'){if(e.expectedVersion!==s.version)throw new ToolError('Your list changed. Please try again.');const department=claim.catalogMap?.departments.find(d=>d.id===e.query);const family=claim.catalogMap?.departments.flatMap(d=>d.families).find(f=>f.id===e.query);return s.catalogDiscovery?{name:'discover_products',args:{query:department?.label??family?.label??e.query,search:department?{keywords:[department.label],departmentId:department.id}:family?{keywords:[family.label],familyId:family.id}:undefined}}:{name:'search_products',args:{query:e.query}};}
    if(e.type==='quote_product'){if(e.expectedVersion!==s.version)throw new ToolError('Your list changed. Please check the current prices again.');return {name:'search_products',args:{query:e.sku,quantity:e.quantity,requestedUnit:e.requestedUnit}};}
    if(e.type==='choose_product')return {name:'apply_draft_changes',args:{expectedVersion:e.expectedVersion,operations:[{kind:'add_item',query:e.sku,quantity:e.quantity??null}]}};
    if(e.type==='add_item') return {name:'apply_draft_changes',args:{expectedVersion:e.expectedVersion,operations:[{kind:'add_item',query:e.sku,quantity:e.quantity}]}};
    if(e.type==='set_quantity') return {name:'apply_draft_changes',args:{expectedVersion:e.expectedVersion,operations:[e.quantity===0?{kind:'remove_item',reference:e.lineId}:{kind:'set_quantity',reference:e.lineId,quantity:e.quantity}]}};
    if(e.type==='review') return {name:'preview_order',args:{expectedVersion:e.expectedVersion}};
    if(e.type==='confirm') return {name:'submit_order_request',args:{reviewId:e.reviewId}};
    if(e.type==='select_candidate') {
      const line=s.draft.find(l=>l.id===e.lineId),pending=s.pending;
      const searched=claim.memory?.lineId===e.lineId&&claim.memory.sourceVersion===s.version&&claim.memory.observations.some(o=>o.products.some(p=>p.sku===e.sku));
      if(pending?.kind==='products'&&pending.id===e.questionId&&pending.version===s.version&&pending.groups.some(g=>g.lineId===e.lineId)&&searched&&claim.displayedActions.some(action=>digest(action)===digest(e)))return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:e.lineId,query:e.sku}]}};
      if(!pending||pending.kind!=='question'||pending.id!==e.questionId||pending.version!==s.version||pending.lineId!==e.lineId||(!line?.candidates?.some(p=>p.sku===e.sku)&&!searched)) throw new ToolError('This candidate choice is stale or does not belong to the pending question.');
      return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:e.lineId,query:e.sku}]}};
    }
    if(e.type!=='text') return;
    const text=e.text.trim().toLowerCase().replace(/[.!?]+$/,'');
    if(isRecheck(e.text)) {
      if(claim.bindingId&&claim.bindingId!==conversationBinding(s,claim.memory))throw new ToolError('That recheck referred to an earlier question. Please name the current item; your list is unchanged.','stale_question');
      if(claim.memory?.purpose==='quote'&&claim.memory.sourceVersion===s.version)return {name:'search_products',args:{query:claim.memory.queries[0],quantity:claim.memory.quoteQuantity,requestedUnit:claim.memory.quoteUnit}};
      if(s.pending?.kind==='products')return {name:'preview_order',args:{expectedVersion:s.version}};
      return {name:'get_draft',args:{}};
    }
    const remembered=claim.memory?.sourceVersion===s.version&&claim.memory.purpose==='discovery'?claim.memory.observations.find(o=>o.discovery)?.discovery:undefined;
    const filter=remembered?.facets[0]?.values.find(v=>v.value.toLowerCase()===text||v.label.toLowerCase()===text);
    if(filter){if(claim.bindingId!==claim.memory!.id)throw new ToolError('That filter answer was for an earlier search.','stale_question');return {name:'discover_products',args:{query:remembered!.query,search:refinementPlan(remembered!,remembered!.facets[0].key,filter.value)}};}
    const quote=priceInquiry(e.text);if(quote)return {name:'search_products',args:quote};
    if(['review','checkout','enough',"that's all",'view cart','cart'].includes(text)) return {name:'preview_order',args:{expectedVersion:s.version}};
    if(['my orders','order status','status'].includes(text)) return {name:'get_order_status',args:{}};
    const amount=quantityReply(text);
    const shortAnswer=!!amount||/^(?:(?:remove|drop|delete) (?:it|this|that)(?: item)?|(?:the )?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?: one)?)$/.test(text);
    if(shortAnswer&&claim.bindingId&&claim.bindingId!==conversationBinding(s,claim.memory))throw new ToolError('That answer was for an earlier question. Please answer the current product question; your list is unchanged.','stale_question');
    if(['clear my list','clear the list','empty my list'].includes(text))return s.draft.length?{name:'apply_draft_changes',args:{expectedVersion:s.version,operations:s.draft.map(l=>({kind:'remove_item',reference:l.id}))}}:{name:'get_draft',args:{}};
    if(s.pending?.kind==='products'&&['yes','confirm','add these','add these items','add this','add this item','add to my list','add to list','add to catalog','add these to my list','yes add these','yes add these items','yes add to my list','add into catalog','add into the catalog','add to the catalog'].includes(text)&&claim.bindingId!==s.pending.id&&!(claim.memory?.sourceVersion===s.version&&claim.memory.purpose!=='pending'))throw new ToolError('That answer was for an earlier product check. Please use the current choices.','stale_question');
    if(s.pending?.kind==='products'&&claim.bindingId===s.pending.id) {
      const check=s.pending;
      const matching=check.groups.flatMap(g=>(g.discovery?.facets[0]?.values??[]).filter(v=>v.value.toLowerCase()===text||v.label.toLowerCase()===text).map(v=>({group:g,value:v})));
      if(matching.length===1){if(claim.bindingId!==check.id)throw new ToolError('That answer was for an earlier category question.','stale_question');const m=matching[0],line=s.draft.find(l=>l.id===m.group.lineId)!;return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:line.id,query:line.query??line.name,search:refinementPlan(m.group.discovery!,m.group.discovery!.facets[0].key,m.value.value)}]}};}
      if(['yes','confirm','add these','add these items','add this','add this item','add to my list','add to list','add to catalog','add these to my list','yes add these','yes add these items','yes add to my list','add into catalog','add into the catalog','add to the catalog'].includes(text)) {
        if(claim.bindingId!==check.id)throw new ToolError('That answer was for an earlier product check. Please use the current choices.','stale_question');
        if(check.groups.some(g=>g.products.length!==1&&!(s.catalogDiscovery&&s.draft.some(l=>l.id===g.lineId&&g.products.some(p=>p.sku===l.sku)))))throw new ToolError('Which option did you mean? Please choose the product for each item from the photos. Nothing has been sent to the shop.');
        return {name:'confirm_product_choices',args:{batchId:check.id,choices:check.groups.map(g=>({lineId:g.lineId,sku:s.catalogDiscovery?s.draft.find(l=>l.id===g.lineId)?.sku??g.products[0].sku:g.products[0].sku}))}};
      }
      if(amount) {
        const targets=check.groups.filter(g=>!amount.unit||g.products.every(p=>sameUnit(amount.unit!,p.unit)));
        if(targets.length!==1)throw new ToolError('Which item is that quantity for? Include the product name, or choose its photo first.');
        return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:targets[0].lineId,quantity:amount.quantity,...(amount.unit?{requestedUnit:amount.unit}:{})}]}};
      }
    }
    if(['yes','confirm','place order','send it'].includes(text)) {
      const found=[...new Map((claim.memory?.sourceVersion===s.version?claim.memory.observations:[]).flatMap(o=>o.products).map(p=>[p.sku,p])).values()];
      if(claim.memory?.sourceVersion===s.version&&claim.memory.purpose==='quote')return {name:'get_draft',args:{}};
      if(text==='yes'&&claim.memory?.purpose==='discovery'&&found.length===1) {
        if(claim.bindingId!==claim.memory.id)throw new ToolError('That answer was for an earlier option. Please choose the current product; your list is unchanged.','stale_question');
        return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'add_item',query:found[0].sku,quantity:null}]}};
      }
      if(claim.memory?.sourceVersion===s.version&&claim.memory.purpose==='discovery')return {name:'get_draft',args:{}};
      if(s.pending?.kind==='review')return {name:'submit_order_request',args:{reviewId:claim.bindingId??'00000000-0000-4000-8000-000000000000'}};
      if(s.pending?.kind==='question'&&conversationBinding(s,claim.memory)===claim.bindingId&&s.pending.version===s.version){const pending=s.pending;const line=s.draft.find(l=>l.id===pending.lineId);
        if(text==='yes'&&line&&!line.sku&&(line.resolution==='needs_choice'||line.resolution==='unavailable')&&claim.memory?.lineId===line.id&&found.length===1)return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:line.id,query:found[0].sku}]}};
        if(claim.memory?.lineId===line?.id&&found.length>1)return {name:'get_draft',args:{}};
        if(line?.resolution==='needs_choice'&&line.candidates?.length===1)return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:line.id,query:line.candidates[0].sku}]}};
      }
      return {name:'get_draft',args:{}};
    }
    if(s.pending?.kind==='question'&&conversationBinding(s,claim.memory)===claim.bindingId&&s.pending.version===s.version&&(!claim.memory||claim.memory.purpose==='pending')) {
      const pendingQuestion=s.pending;
      const pendingLine=s.draft.find(l=>l.id===pendingQuestion.lineId);
      if(/^(?:remove|drop|delete) (?:it|this|that)(?: item)?$/.test(text))return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'remove_item',reference:pendingLine!.id}]}};
      if(amount&&pendingLine&&(pendingLine.resolution==='needs_quantity'||pendingLine.resolution==='needs_unit')) {
        if(pendingLine.resolution==='needs_unit'&&!amount.unit)return {name:'get_draft',args:{}};
        return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:pendingLine.id,quantity:amount.quantity,...(amount.unit?{requestedUnit:amount.unit}:{})}]}};
      }
      if(/^(one|two|three|four|five|six|seven|eight|nine|ten)$/.test(text)&&pendingLine?.resolution==='needs_choice')return {name:'get_draft',args:{}};
      // A bare number answers a quantity question; it is not a catalog choice.
      if(pendingLine?.resolution==='needs_quantity'&&/^\d+(?:\.\d+)?$/.test(text))return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:pendingLine.id,quantity:Number(text)}]}};
      const ordinal=/^(?:the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|10|[1-9])(?: one)?$/.exec(text);
      if(ordinal&&pendingLine?.resolution==='needs_choice') {
        const n=({first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10} as Record<string,number>)[ordinal[1]]??Number(ordinal[1]);
        const question=s.pending;
        const line=s.draft.find(l=>l.id===question.lineId),product=line?.candidates?.[n-1];
        if(product) return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:line!.id,query:product.sku}]}};
        throw new ToolError('That numbered choice is not in the current candidate list.');
      }
    }
    if(/^(?:the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|10|[1-9])(?: one)?$/.test(text)) throw new ToolError('That choice is not bound to the current question. Use the current choices or describe the product.');
    return undefined;
  }
  private async interpret(ctx:ActorContext,claim:Claimed):Promise<Interpretation> {
    const recent=(await this.pool.query("SELECT direction,left(text,500) AS text FROM messages WHERE conversation_id=$1 AND status IN ('processed','sent') ORDER BY sequence DESC LIMIT 8",[ctx.conversationId])).rows.reverse();
    const voice=claim.event.type==='voice';
    if(voice&&!this.provider.supportsAudio)throw new ToolError('Voice input is not configured. Please type your request.');
    const audio=voice?await loadVoice(this.pool,ctx,(claim.event as Extract<SimulatorEvent,{type:'voice'}>).mediaId):undefined;
    if(audio&&audio.sourceVersion!==claim.state.version)throw new ToolError('That voice note belongs to an earlier product question. Please record the current request again.','stale_version');
    const text=claim.event.type==='text'?claim.event.text:'Recorded customer voice note';
    const observations=voice?[]:await withConversation(this.pool,ctx,async client=>observeCatalog(client,ctx,this.tools,observationQueries(text,claim.state,claim.memory),`${claim.id}:observe`));
    const input={history:recent,text,audio,state:claim.state,catalog:claim.catalog,catalogMap:claim.catalogMap,assistantMemory:claim.memory,observations};
    this.provider.validateInput?.(input);
    // A committed reservation precedes every potentially paid invocation.
    const reservation=await withConversation(this.pool,ctx,async client=>{
      const held=await client.query("SELECT 1 FROM messages WHERE id=$1 AND status='processing' AND claim_token=$2 AND lease_until>now()",[claim.id,claim.token]);
      if(!held.rowCount) throw new ToolError('Work lease expired before interpretation.');
      const current=await loadState(client,ctx);
      if(current.version!==claim.state.version) throw new ToolError('Draft changed before interpretation.');
      return reserveAttempt(client,ctx,claim.id,claim.state.version,this.provider);
    });
    if(reservation.exhausted) throw new ToolError('Interpretation attempt limit reached. Please rephrase or ask the shop.');
    if('denied' in reservation&&reservation.denied) throw new ToolError('Inference budget unavailable or exhausted. Your draft is retained.',this.provider.freeQuota?'quota_unavailable':'budget_unavailable');
    if(reservation.cached) return interpretationSchema.parse(reservation.cached);
    let failureCode='provider_error';
    try {
      const signal=AbortSignal.timeout(10000);
      const output=await Promise.race([this.provider.interpret(input,signal),new Promise<never>((_,reject)=>{signal.addEventListener('abort',()=>reject(new Error('Interpretation timed out; draft retained.')),{once:true});})]);
      failureCode='usage_validation';
      if(!await settleAttempt(this.pool,ctx,reservation.id!,output)) throw new ToolError('Provider usage exceeded the verified limits. No changes applied.');
      failureCode='truncated_or_model_mismatch';
      if(output.truncated) throw new ToolError('Interpretation was truncated. No partial list was applied.');
      failureCode=output.output===null?'invalid_json':'invalid_operations';
      const parsed=interpretationSchema.safeParse(output.output);
      if(!parsed.success||voice&&!parsed.data.transcript) throw new ToolError('Could not validate all requested actions. Please rephrase; no changes were applied.');
      failureCode='ledger_write';
      const valid=parsed.data;
      await this.pool.query("UPDATE provider_attempts SET state='succeeded',response=$1::jsonb,usage=$2::jsonb WHERE id=$3",[JSON.stringify(valid),JSON.stringify(output.usage),reservation.id]);
      return valid;
    } catch(error) {
      if(this.provider.freeQuota&&error instanceof FreeQuotaError) await coolDownFreeQuota(this.pool,this.provider.freeQuota);
      await settleAttempt(this.pool,ctx,reservation.id!);
      await this.pool.query("UPDATE provider_attempts SET state='failed',failure_code=$2 WHERE id=$1",[reservation.id,error instanceof FreeQuotaError?'rate_limited':failureCode]);
      throw error;
    }
  }
}

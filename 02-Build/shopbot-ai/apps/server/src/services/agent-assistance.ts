import {say,canonicalShortcut,safeQuestion} from '../../../../packages/contracts/language.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {turnUnderstandingSchema,type TurnUnderstanding} from '../../../../packages/contracts/understanding.js';
import type {KeepSelection} from './shopping-corrections.js';
import type {PoolClient} from 'pg';
import {discoveryPlanSchema,operationSchema,deferredCartTargetSchema,type Interpretation,type ConversationState,type Product,type RichReply,type DiscoveryPlan,type DiscoveryResult} from '../../../../packages/contracts/index.js';
import type {ActorContext} from './context.js';
import {catalogEnabled} from './catalog.js';
import {discoveryPresentation} from './discovery-replies.js';
import type {RetailTools} from './tools.js';

export type CatalogObservation={tool:'search_products'|'discover_products';query:string;products:Product[];totalCount:number;discovery?:DiscoveryResult};
const correctionSchema=z.object({description:z.string().trim().min(1).max(4000),understanding:turnUnderstandingSchema,selections:z.array(z.object({targetIndex:z.number().int().min(0).max(49),lineId:z.uuid()}).strict()).max(50)}).strict();
const cartEditSchema=z.object({description:z.string().trim().min(1).max(4000),understanding:turnUnderstandingSchema,targets:z.array(deferredCartTargetSchema).min(1).max(100),selections:z.array(z.object({kind:z.enum(['edit','item']),index:z.number().int().min(0).max(99),lineId:z.uuid()}).strict()).max(100)}).strict();
const memorySchema=z.object({cartEdit:cartEditSchema.optional(),correction:correctionSchema.optional(),id:z.uuid(),purpose:z.enum(['discovery','quote','pending','list_choice','cart_correction','cart_edit']),queries:z.array(z.string().min(1).max(200)).min(1).max(3),lineId:z.uuid().nullable(),sourceVersion:z.number().int().min(0),catalogRevision:z.number().int().min(0).optional(),quoteSearch:discoveryPlanSchema.optional(),quoteQuantity:z.number().min(0.001).max(100).optional(),quoteUnit:z.string().max(200).optional(),requestedQuantity:z.number().min(0.001).max(100).optional(),requestedUnit:z.string().max(200).optional(),orderTarget:z.enum(['choose','existing']).optional(),sourceMessageId:z.uuid().optional(),newList:z.array(operationSchema.options[0]).min(1).max(50).optional(),observations:z.array(z.object({tool:z.enum(['search_products','discover_products']),query:z.string().max(200),products:z.array(z.any()).max(10),totalCount:z.number().int().min(0),discovery:z.any().optional()})).max(3)});
export type AssistantMemory={id:string;purpose:'discovery'|'quote'|'pending'|'list_choice'|'cart_correction'|'cart_edit';cartEdit?:z.infer<typeof cartEditSchema>;correction?:{description:string;understanding:TurnUnderstanding;selections:KeepSelection[]};orderTarget?:'choose'|'existing';sourceMessageId?:string;queries:string[];lineId:string|null;sourceVersion:number;catalogRevision?:number;quoteSearch?:DiscoveryPlan;quoteQuantity?:number;quoteUnit?:string;requestedQuantity?:number;requestedUnit?:string;newList?:Extract<Interpretation['operations'][number],{kind:'add_item'}>[];observations:CatalogObservation[]};
export async function loadAssistantMemory(client:PoolClient,ctx:ActorContext):Promise<AssistantMemory|null> {
  const row=(await client.query('SELECT c.assistant_memory,s.catalog_revision FROM conversations c JOIN stores s ON s.id=c.store_id WHERE c.id=$1 AND c.store_id=$2 AND c.actor=$3',[ctx.conversationId,ctx.storeId,ctx.actor])).rows[0];
  const parsed=memorySchema.safeParse(row?.assistant_memory);
  return parsed.success&&(parsed.data.purpose==='list_choice'||parsed.data.catalogRevision===row.catalog_revision)?parsed.data:null;
}
export async function saveAssistantMemory(client:PoolClient,ctx:ActorContext,memory:Omit<AssistantMemory,'id'>|null) {
  const id=randomUUID();
  const revision=memory?(await client.query('SELECT catalog_revision FROM stores WHERE id=$1',[ctx.storeId])).rows[0].catalog_revision:undefined;
  await client.query('UPDATE conversations SET assistant_memory=$1::jsonb WHERE id=$2 AND store_id=$3 AND actor=$4',[JSON.stringify(memory?{...memory,id,catalogRevision:revision}:null),ctx.conversationId,ctx.storeId,ctx.actor]);
  return memory?id:undefined;
}
export function pendingItem(state:ConversationState) {
  const pending=state.pending;
  return pending?.kind==='question'?state.draft.find(l=>l.id===pending.lineId):pending?.kind==='products'&&pending.groups.length===1?state.draft.find(l=>l.id===pending.groups[0].lineId):undefined;
}
export function conversationBinding(state:ConversationState,memory:AssistantMemory|null) {
  if(state.pending?.kind==='products'&&!(memory?.sourceVersion===state.version&&memory.purpose!=='pending'))return state.pending.id;
  return memory?.sourceVersion===state.version?memory.id:state.pending?.id??null;
}
// Retrieval hints only: the model still decides intent, queries and edits.
export function observationQueries(text:string,state:ConversationState,memory:AssistantMemory|null) {
  const current=text.trim().replace(/^(?:please\s+)?(?:i (?:want|need)|can i get|could i get|do you have|show me|find me)\s+/i,'').replace(/[.!?]+$/,'').slice(0,200);
  const pending=pendingItem(state);
  return [...new Set([current,pending?.query??memory?.queries[0]].filter((x):x is string=>!!x))].slice(0,2);
}
export function isRecheck(text:string) {return /^(?:(?:please|can you|could you) )?(?:check|look|search|try)(?: it| that| the catalog)? again(?: please)?[.!?]*$/i.test(canonicalShortcut(text));}
export function recheckQueries(state:ConversationState,memory:AssistantMemory|null) {
  const pending=pendingItem(state),queries=memory?.sourceVersion===state.version?memory.queries:pending?[pending.query??pending.name]:[];
  return [...new Set(queries.flatMap(q=>[q,...(/^[a-z]+\s+[a-z]+$/i.test(q)?[q.replace(/\s+/g,'')]:[])]))].slice(0,3);
}
export async function observeCatalog(client:PoolClient,ctx:ActorContext,tools:RetailTools,queries:string[],key:string,search?:DiscoveryPlan):Promise<CatalogObservation[]> {
  const results:CatalogObservation[]=[];
  for(const [index,query] of [...new Set(queries)].slice(0,3).entries()) {
    const native=await catalogEnabled(client,ctx);
    const result=await tools.invokeInTransaction(client,ctx,native?{name:'discover_products',args:{query,search:{keywords:[query.slice(0,120)],...search,allowAlternatives:search?.allowAlternatives??true}}}:{name:'search_products',args:{query}},`${key}:catalog:${index}`);
    results.push({tool:native?'discover_products':'search_products',query,products:result.products??[],totalCount:result.totalCount??0,discovery:result.discovery});
  }
  return results;
}
export function assistanceReply(observations:CatalogObservation[],state:ConversationState,question?:string,rechecked=false,targetLineId?:string,memoryId?:string,selection?:{quantity?:number;unit?:string}):RichReply {
  if(observations[0]?.discovery&&observations.length===1)return discoveryPresentation(observations[0].discovery,state,memoryId,targetLineId,question,selection);
  const available=[...new Map(observations.flatMap(o=>o.products).map(p=>[p.sku,p])).values()];
  const diverse=state.catalogDiscovery?available.filter((p,i)=>available.findIndex(v=>v.familyId===p.familyId)===i):available;
  const products=(state.catalogDiscovery?[...diverse,...available.filter(p=>!diverse.includes(p))]:available).slice(0,10);
  // Questions are authored by the model; factual commerce statements always
  // come from verified tool results and the backend presentation below.
  const focusedQuestion=safeQuestion(question,state);
  const queries=observations.map(o=>o.query).join(' / ');
  const line=targetLineId?state.draft.find(l=>l.id===targetLineId):undefined;
  let text=products.length?`${rechecked?'I checked again. ':''}Here are the catalog options I found. ${focusedQuestion??'Which one fits what you need? You can also tell me what you’ll use it for.'}`:`${rechecked?'I checked again':'I checked the catalog'}, including ${queries}. There’s no matching listing here. That doesn’t tell us whether the shop can source it. ${focusedQuestion??'What will you use it for, or would you like to leave it for the shop to check?'}`;
  if(state.catalogDiscovery&&!products.length)text='What job will you use it for, and do you know the size or brand? I’ll help identify the product and keep your request for the shop to check.';
  if(!products.length&&line)text+=' I’ve kept your request on the list; I haven’t substituted another product.';
  if(state.catalogDiscovery&&observations.some(o=>o.discovery?.noExactMatch))text+=' Some photos are related suggestions. Choose them only if you want those items instead.';
  text=say(state,text,products.length?`${rechecked?'மீண்டும் பார்த்தேன். ':''}இந்தப் பொருட்கள் பட்டியலில் உள்ளன. ${focusedQuestion??'படங்களில் எது வேண்டும்? என்ன வேலைக்குத் தேவை என்றும் சொல்லலாம்.'}`:'என்ன வேலைக்குத் தேவை? அளவு அல்லது பிராண்ட் தெரியுமா? பொருளைக் கண்டறிய உதவுகிறேன். உங்கள் கோரிக்கையை கடை சரிபார்க்க வைத்துள்ளேன்.',products.length?`${rechecked?'Marubadi paarththen. ':''}Intha porutkal catalog-la irukku. ${focusedQuestion??'Photos-la ethu venum? Enna velaikku venum-num sollalaam.'}`:'Enna velaikku venum? Size illa brand theriyuma? Porulai kandupidikka udhavuren. Unga request-ai kadai check panna vechchirukken.');
  if(products.length&&state.catalogDiscovery&&observations.some(o=>o.discovery?.noExactMatch))text+=say(state,'',' தொடர்புடைய பரிந்துரைகளை மட்டும் காட்டுகிறேன்; வேண்டிய பொருளா என்று சரிபாருங்கள்.','Thodarbudaiya suggestions mattum kaatturen; venum porula-nu check pannunga.');
  const cards=products.map(product=>({product,matchLabel:observations.some(o=>o.discovery?.rankings.some(r=>r.sku===product.sku&&r.match==='related'))?say(state,'Related option · please check','தொடர்புடைய பொருள் · சரிபார்க்கவும்','Thodarbudaiya porul · check pannunga'):undefined,label:line?say(state,'Use for this item','இந்தப் பொருளை பயன்படுத்து','Intha porulai use pannu'):say(state,'Choose this','இது வேணும்','Ithai choose pannu'),action:line?{id:randomUUID(),type:'select_candidate' as const,questionId:state.pending!.id,lineId:line.id,sku:product.sku}:{id:randomUUID(),type:'choose_product' as const,sku:product.sku,expectedVersion:state.version}}));
  return {version:1,kind:cards.length?'product_choices':'text',text,cards:cards.length?cards:undefined,presentation:cards.length===1?'single_product':cards.length&&cards.every(c=>c.product.imageUrl)?'carousel_preview':cards.length?'list':'text',outboundMessages:1};
}

import {say,productName as displayName} from '../../../../packages/contracts/language.js';
import type {ImageMedia} from './image-media.js';
import type {VoiceMedia} from './voice-media.js';
import { isDeepStrictEqual } from 'node:util';
import type { Pool } from 'pg';
import { eventSchema, type SimulatorEvent, type Snapshot } from '../../../../packages/contracts/index.js';
import { fixtureConversation, fixtureStore } from '../../../../profiles/hardware.js';
import { MockInterpreter } from '../adapters/mock-interpreter.js';
import {assertMockProvider,type Interpreter} from '../adapters/interpreter.js';
import { ConversationRuntime } from '../runtime/conversation.js';
import { loadState } from './tools.js';
import { getProducts,catalogEnabled,catalogContext,searchProducts } from './catalog.js';
import {getCatalogMap} from './catalog-discovery.js';
import { withConversation, type ActorContext } from './context.js';
import {loadAssistantMemory,conversationBinding} from './agent-assistance.js';

export const simulatorContext:ActorContext={storeId:fixtureStore,conversationId:fixtureConversation,actor:'local-simulator',role:'customer'};
// A channel test adapter only. Identity is fixed server-side; shared retail tools
// and runtime contain no fixture IDs, hardware families or channel permissions.
export class SimulatorService {
  readonly runtime:ConversationRuntime;
  constructor(private pool:Pool,readonly context:ActorContext=simulatorContext,private provider:Interpreter=new MockInterpreter()) {assertMockProvider(provider);this.runtime=new ConversationRuntime(pool,provider);}
  async snapshot():Promise<Snapshot> {
    return withConversation(this.pool,this.context,async client=>{
      const ctx=this.context;
      const enabled=await catalogEnabled(client,ctx),catalog=enabled?await catalogContext(client,ctx):await getProducts(client,ctx),conversation=await loadState(client,ctx),catalogMap=enabled?await getCatalogMap(client,ctx):undefined,memory=await loadAssistantMemory(client,ctx),discoveryBindingId=memory?.purpose==='discovery'&&memory.sourceVersion===conversation.version?memory.id:undefined;
      const history=await client.query("SELECT m.id,m.direction,m.text,m.status,m.created_at,m.payload,v.duration_seconds FROM messages m LEFT JOIN voice_media v ON m.payload->>'mediaId'=v.id::text AND v.conversation_id=m.conversation_id WHERE m.conversation_id=$1 ORDER BY m.sequence",[ctx.conversationId]);
      const requests=await client.query('SELECT id,acceptance,payment,fulfillment,total_paise,lines FROM order_requests WHERE store_id=$1 AND conversation_id=$2 AND actor=$3 ORDER BY created_at',[ctx.storeId,ctx.conversationId,ctx.actor]);
      const attempts=await client.query('SELECT count(*)::int AS count FROM provider_attempts WHERE store_id=$1 AND conversation_id=$2 AND actor=$3',[ctx.storeId,ctx.conversationId,ctx.actor]);
      return {catalogMap,discoveryBindingId,mode:'mock',provider:this.provider.name,catalog,conversation,messages:history.rows.map(r=>({id:r.id,direction:r.direction,text:r.text,status:r.status,createdAt:r.created_at,voice:r.payload?.type==='voice'?{mediaId:r.payload.mediaId,durationSeconds:Number(r.duration_seconds)}:undefined,image:r.payload?.type==='image'?{mediaId:r.payload.mediaId}:undefined,rich:r.direction==='outbound'?r.payload??undefined:undefined})),pending:history.rows.filter(m=>['pending','processing'].includes(m.status)).length,
        requests:requests.rows.map(r=>({id:r.id,acceptance:r.acceptance,payment:r.payment,fulfillment:r.fulfillment,totalPaise:Number(r.total_paise),lines:r.lines})),interpretationAttempts:attempts.rows[0].count};
    });
  }
  async ingest(input:SimulatorEvent,voice?:VoiceMedia,image?:ImageMedia) {
    const event=eventSchema.parse(input),ctx=this.context;
    return withConversation(this.pool,ctx,async client=>{
      const state=await loadState(client,ctx);
      if(event.type==='voice'){if(!voice||event.id!==event.mediaId)throw new Error('Voice messages require a verified upload.');const old=(await client.query('SELECT source_hash FROM voice_media WHERE id=$1 AND store_id=$2 AND conversation_id=$3 AND actor=$4',[event.id,ctx.storeId,ctx.conversationId,ctx.actor])).rows[0];if(old&&old.source_hash!==voice.sourceHash)throw Object.assign(new Error('This voice ID was used for a different recording.'),{statusCode:409});if(!old)await client.query('INSERT INTO voice_media(id,store_id,conversation_id,actor,source_hash,audio,duration_seconds,source_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[event.id,ctx.storeId,ctx.conversationId,ctx.actor,voice.sourceHash,voice.audio,voice.durationSeconds,state.version]);}
      if(event.type==='image'){if(!image||event.id!==event.mediaId)throw new Error('Image messages require a verified upload.');const old=(await client.query('SELECT source_hash FROM image_media WHERE id=$1 AND store_id=$2 AND conversation_id=$3 AND actor=$4',[event.id,ctx.storeId,ctx.conversationId,ctx.actor])).rows[0];if(old&&old.source_hash!==image.sourceHash)throw Object.assign(new Error('This image ID was used for a different photo.'),{statusCode:409});if(!old)await client.query('INSERT INTO image_media(id,store_id,conversation_id,actor,source_hash,image,width,height,source_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[event.id,ctx.storeId,ctx.conversationId,ctx.actor,image.sourceHash,image.image,image.width,image.height,state.version]);}
      const memory=await loadAssistantMemory(client,ctx);
      const product='sku' in event?(await searchProducts(client,ctx,event.sku))[0]:undefined;
      const productName=product?displayName(product,state):('sku' in event?event.sku:'item');
      const englishText=event.type==='image'?(event.caption||'Find products like this photo'):event.type==='voice'?`Voice note · ${Math.ceil(voice!.durationSeconds)}s`:event.type==='refine_discovery'?`Show ${event.value} options`:event.type==='text'?event.text:event.type==='browse'?`Show ${event.query}`:event.type==='quote_product'?`Check the price of ${productName}`:event.type==='refine_search'?`For this item: ${event.value}`:event.type==='select_product'?`Yes, ${productName} is the item I meant`:event.type==='confirm_products'?'Add these checked products to my list':event.type==='choose_product'?(event.quantity!==undefined?`Add ${event.quantity} × ${productName} to my list`:`I’d like ${productName}`):event.type==='add_item'?`Add ${event.quantity} × ${productName}`:event.type==='set_quantity'?`Set line ${event.lineId} quantity to ${event.quantity}`:event.type==='review'?'Review my list':event.type==='confirm'?'Yes, send my request to the shop':`I’d like ${productName}`;
      const text=event.type==='text'?event.text:event.type==='image'?event.caption||say(state,englishText,'இந்தப் படம் போன்ற பொருட்களைத் தேடு','Intha photo pola porutkalai thedu'):event.type==='voice'?say(state,englishText,`குரல் பதிவு · ${Math.ceil(voice!.durationSeconds)} வினாடி`,`Kural pathivu · ${Math.ceil(voice!.durationSeconds)} vinadi`):event.type==='change_language'?say(event.language,'Reply in English','தமிழில் பேசு','Tanglish-la pesu'):event.type==='confirm'?say(state,englishText,'ஆம், கோரிக்கையைக் கடைக்கு அனுப்பு','Aama, request-ai kadaikku anuppu'):event.type==='review'?say(state,englishText,'என் பட்டியலைக் காட்டு','En list-ai kaatu'):event.type==='confirm_products'?say(state,englishText,'சரிபார்த்த பொருட்களை என் பட்டியலில் சேர்','Check panna porutkalai en list-la seru'):event.type==='browse'?say(state,englishText,'இந்த வகைப் பொருட்களைக் காட்டு','Intha vagai porutkalai kaatu'):event.type==='refine_search'||event.type==='refine_discovery'?say(state,englishText,'இந்தத் தேர்வின்படி பொருட்களைக் காட்டு','Intha choice-padi porutkalai kaatu'):event.type==='set_quantity'?say(state,englishText,`எண்ணிக்கையை ${event.quantity} ஆக மாற்று`,`Quantity-ai ${event.quantity}-aa maathu`):event.type==='quote_product'?say(state,englishText,`${productName} விலையைப் பார்`,`${productName} vilai paaru`):say(state,englishText,`${productName} வேண்டும்`,`${productName} venum`);
      const result=await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload,binding_id) VALUES($1,$2,'inbound',$3,'pending',$4::jsonb,$5) ON CONFLICT(id) DO NOTHING RETURNING id",[event.id,ctx.conversationId,text,JSON.stringify(event),conversationBinding(state,memory)]);
      if(!result.rowCount) {
        const old=await client.query('SELECT payload FROM messages WHERE id=$1 AND conversation_id=$2',[event.id,ctx.conversationId]);
        if(!old.rows[0]||!isDeepStrictEqual(old.rows[0].payload,event)) {
          const error=new Error('This event ID was already used for different content');Object.assign(error,{statusCode:409});throw error;
        }
      }
      return {id:event.id,duplicate:!result.rowCount};
    });
  }
  async hasPending() {
    const result=await this.pool.query("SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.id=$1 AND c.store_id=$2 AND c.actor=$3 AND (m.status='pending' OR (m.status='processing' AND m.lease_until<=now())) LIMIT 1",[this.context.conversationId,this.context.storeId,this.context.actor]);
    return Boolean(result.rowCount);
  }
  async processNext() {return this.runtime.processNext(this.context);}
}

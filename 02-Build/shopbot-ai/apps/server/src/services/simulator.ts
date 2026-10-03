import { isDeepStrictEqual } from 'node:util';
import type { Pool } from 'pg';
import { eventSchema, type SimulatorEvent, type Snapshot } from '../../../../packages/contracts/index.js';
import { fixtureConversation, fixtureStore } from '../../../../profiles/hardware.js';
import { MockInterpreter } from '../adapters/mock-interpreter.js';
import {assertMockProvider,type Interpreter} from '../adapters/interpreter.js';
import { ConversationRuntime } from '../runtime/conversation.js';
import { loadState } from './tools.js';
import { getProducts } from './catalog.js';
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
      const catalog=await getProducts(client,ctx),conversation=await loadState(client,ctx);
      const history=await client.query('SELECT id,direction,text,status,created_at,payload FROM messages WHERE conversation_id=$1 ORDER BY sequence',[ctx.conversationId]);
      const requests=await client.query('SELECT id,acceptance,payment,fulfillment,total_paise,lines FROM order_requests WHERE store_id=$1 AND conversation_id=$2 AND actor=$3 ORDER BY created_at',[ctx.storeId,ctx.conversationId,ctx.actor]);
      const attempts=await client.query('SELECT count(*)::int AS count FROM provider_attempts WHERE store_id=$1 AND conversation_id=$2 AND actor=$3',[ctx.storeId,ctx.conversationId,ctx.actor]);
      return {mode:'mock',provider:this.provider.name,catalog,conversation,messages:history.rows.map(r=>({id:r.id,direction:r.direction,text:r.text,status:r.status,createdAt:r.created_at,rich:r.direction==='outbound'?r.payload??undefined:undefined})),pending:history.rows.filter(m=>['pending','processing'].includes(m.status)).length,
        requests:requests.rows.map(r=>({id:r.id,acceptance:r.acceptance,payment:r.payment,fulfillment:r.fulfillment,totalPaise:Number(r.total_paise),lines:r.lines})),interpretationAttempts:attempts.rows[0].count};
    });
  }
  async ingest(input:SimulatorEvent) {
    const event=eventSchema.parse(input),ctx=this.context;
    return withConversation(this.pool,ctx,async client=>{
      const state=await loadState(client,ctx);
      const memory=await loadAssistantMemory(client,ctx);
      const product='sku' in event?(await getProducts(client,ctx)).find(p=>p.sku===event.sku):undefined;
      const productName=product?.name??('sku' in event?event.sku:'item');
      const text=event.type==='text'?event.text:event.type==='browse'?`Show ${event.query}`:event.type==='quote_product'?`Check the price of ${productName}`:event.type==='select_product'?`Yes, ${productName} is the item I meant`:event.type==='confirm_products'?'Add these checked products to my list':event.type==='choose_product'?(event.quantity!==undefined?`Add ${event.quantity} × ${productName} to my list`:`I’d like ${productName}`):event.type==='add_item'?`Add ${event.quantity} × ${productName}`:event.type==='set_quantity'?`Set line ${event.lineId} quantity to ${event.quantity}`:event.type==='review'?'Review my list':event.type==='confirm'?'Yes, send my request to the shop':`I’d like ${productName}`;
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

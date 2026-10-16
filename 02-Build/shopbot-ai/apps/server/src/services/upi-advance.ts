import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import QRCode from 'qrcode';
import type {PoolClient} from 'pg';
import type {ConversationState,RichReply} from '../../../../packages/contracts/index.js';
import {customerCopy} from '../../../../packages/contracts/customer-copy.js';
import {say} from '../../../../packages/contracts/language.js';
import {visualMediaDir} from './visual-images.js';
import {ToolError,type ActorContext} from './context.js';

export type UpiAdvanceConfig={vpa:string;name:string;hostname:string;demoPayAtShop?:boolean};
export function readUpiAdvance(env:NodeJS.ProcessEnv,hostname?:string):UpiAdvanceConfig|undefined {
 if(env.UPI_ADVANCE_ENABLED!=='true')return;
 const vpa=env.UPI_PAYEE_VPA?.trim()??'',name=env.UPI_PAYEE_NAME?.trim()??'';
 if(!/^[a-zA-Z0-9._-]{2,200}@[a-zA-Z0-9.-]{2,80}$/.test(vpa)||!name||name.length>80||/[\r\n<>\u0000-\u001f]/.test(name)||!hostname||!/^[a-z0-9.-]+$/.test(hostname))throw new Error('UPI advance needs an exact payee VPA, recipient name and WhatsApp hostname. A phone number is not a VPA.');
 return {vpa,name,hostname,demoPayAtShop:env.UPI_DEMO_PAY_AT_SHOP_ENABLED==='true'};
}
export function upiUri(config:Pick<UpiAdvanceConfig,'vpa'|'name'>,reference:string) {
 if(!/^[a-zA-Z0-9._-]{2,200}@[a-zA-Z0-9.-]{2,80}$/.test(config.vpa)||!config.name.trim()||config.name.length>80)throw new Error('Invalid UPI recipient');
 if(!/^[a-zA-Z0-9]{1,35}$/.test(reference))throw new Error('Invalid UPI reference');
 return 'upi://pay?'+new URLSearchParams({pa:config.vpa,pn:config.name,am:'10.00',cu:'INR',tr:reference,tn:'Order advance '+reference}).toString();
}
export async function createUpiAdvance(client:PoolClient,ctx:ActorContext,requestId:string,reviewId:string,config:UpiAdvanceConfig) {
 const id=randomUUID(),uri=upiUri(config,'SGO'+requestId.replaceAll('-',''));
 await client.query("INSERT INTO order_advances(id,store_id,request_id,amount_paise,payee_vpa,payee_name,upi_uri,review_id,demo_pay_at_shop_allowed) VALUES($1,$2,$3,1000,$4,$5,$6,$7,$8)",[id,ctx.storeId,requestId,config.vpa,config.name,uri,reviewId,!!config.demoPayAtShop]);
 await client.query("UPDATE order_requests SET advance_required=true,payment='pending' WHERE id=$1 AND store_id=$2",[requestId,ctx.storeId]);
 return id;
}
export async function qrImage(uri:string,directory=visualMediaDir()) {
 const hash=createHash('sha256').update('upi-qr-v1:'+uri).digest('hex'),filename=hash+'.png';
 mkdirSync(directory,{recursive:true});
 const path=join(directory,filename);
 if(!existsSync(path)){
  const buffer=await QRCode.toBuffer(uri,{type:'png',width:720,margin:4,errorCorrectionLevel:'M'});
  try{writeFileSync(path,buffer,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 }
 return '/catalog-images/messages/'+filename;
}
export async function upiAdvanceReply(client:PoolClient,ctx:ActorContext,state:ConversationState,hostname:string,options:{demoPayAtShop?:boolean;onlyOnce?:boolean}={}):Promise<RichReply|null> {
 if(!state.lastRequestId)return null;
 const row=(await client.query('SELECT a.*,r.acceptance,r.fulfillment FROM order_advances a JOIN order_requests r ON r.id=a.request_id WHERE a.store_id=$1 AND a.request_id=$2 AND r.conversation_id=$3 AND r.actor=$4',[ctx.storeId,state.lastRequestId,ctx.conversationId,ctx.actor])).rows[0];
 if(!row||!['requested','claimed'].includes(row.state)||row.acceptance==='rejected'||['cancelled','collected'].includes(row.fulfillment))return null;
 if(options.onlyOnce&&row.offered_at)return null;
 const demo=!!options.demoPayAtShop&&row.demo_pay_at_shop_allowed;
 const reference='Order #'+state.lastRequestId.replaceAll('-','').slice(0,8).toUpperCase();
 const link=`https://${hostname}/pay/${row.id}`,text=say(state,`${reference} sent to the shop.`,`${reference} கடைக்கு அனுப்பியாச்சு.`,`${reference} kadaikku anuppiyaachu.`)+'\n\n'+(row.state==='claimed'?customerCopy('paymentClaimed',state):customerCopy(demo?'demoAdvance':'advance',state,{name:row.payee_name,vpa:row.payee_vpa,link}));
 const event={id:randomUUID(),type:'payment_claim' as const,requestId:state.lastRequestId,expectedVersion:state.version};
 const buttons:NonNullable<RichReply['buttons']>=row.state==='requested'?[{label:say(state,'I have paid','Pay பண்ணிட்டேன்','Pay pannitten'),event},...(demo?[{label:say(state,'Pay fully at shop','கடைல பணம் தர்றேன்','Kadaiyila panam tharen'),event:{id:randomUUID(),type:'pay_at_shop' as const,requestId:state.lastRequestId,expectedVersion:state.version}}]:[])]:[];
 const card={kind:'instruction' as const,title:say(state,'₹10 order advance','₹10 order advance','₹10 order advance'),lines:[],caption:text,imageUrl:await qrImage(row.upi_uri),buttons};
 await client.query('UPDATE order_advances SET offered_at=coalesce(offered_at,now()) WHERE id=$1',[row.id]);
 return {version:1,kind:'text',readOnly:true,text,parts:[{id:randomUUID(),cards:[card],text,buttons}],buttons,presentation:'single_product',outboundMessages:1,stage:'status'};
}
export async function chooseDemoPayAtShop(client:PoolClient,ctx:ActorContext,requestId:string,enabled:boolean){
 if(!enabled)throw new ToolError('Pay at shop is only enabled for this demo.','forbidden');
 const row=(await client.query('SELECT a.state,a.demo_pay_at_shop_allowed,r.acceptance,r.fulfillment FROM order_advances a JOIN order_requests r ON r.id=a.request_id WHERE a.request_id=$1 AND a.store_id=$2 AND r.conversation_id=$3 AND r.actor=$4 FOR UPDATE OF a,r',[requestId,ctx.storeId,ctx.conversationId,ctx.actor])).rows[0];
 if(!row?.demo_pay_at_shop_allowed)throw new ToolError('This order does not have the demo pay-at-shop option.','forbidden');
 if(row.state==='pay_at_shop')return;
 if(row.state!=='requested'||row.acceptance!=='awaiting_approval'||row.fulfillment!=='awaiting_approval')throw new ToolError('This payment choice is no longer current.','stale_confirmation');
 await client.query("UPDATE order_advances SET state='pay_at_shop',updated_at=now() WHERE request_id=$1",[requestId]);
 await client.query("UPDATE order_requests SET advance_required=false,payment='not_requested' WHERE id=$1",[requestId]);
}
export async function claimUpiAdvance(client:PoolClient,ctx:ActorContext,requestId:string) {
 const request=(await client.query('SELECT id FROM order_requests WHERE id=$1 AND store_id=$2 AND conversation_id=$3 AND actor=$4',[requestId,ctx.storeId,ctx.conversationId,ctx.actor])).rows[0];
 if(!request)throw new ToolError('This payment request belongs to a different order.','forbidden');
 const advance=(await client.query('SELECT state FROM order_advances WHERE request_id=$1 AND store_id=$2',[requestId,ctx.storeId])).rows[0];
 if(!advance)throw new ToolError('This order has no advance payment request. Ask the shop to check your payment.');
 await client.query("UPDATE order_advances SET state='claimed',claimed_at=coalesce(claimed_at,now()),updated_at=now() WHERE request_id=$1 AND store_id=$2 AND state='requested'",[requestId,ctx.storeId]);
 return advance.state==='requested'?'claimed':advance.state;
}
export async function verifyManualAdvance(client:PoolClient,storeId:string,requestId:string,actor:string,reference:string) {
 if(!/^[a-zA-Z0-9][a-zA-Z0-9 -]{5,79}$/.test(reference))throw new ToolError('Enter the actual bank/UPI transaction reference after checking ₹10 was received.');
 const row=(await client.query('SELECT a.*,r.acceptance,r.fulfillment FROM order_advances a JOIN order_requests r ON r.id=a.request_id AND r.store_id=a.store_id WHERE a.store_id=$1 AND a.request_id=$2 FOR UPDATE OF a,r',[storeId,requestId])).rows[0];
 if(!row)throw new ToolError('Advance request not found.');
 const ref=reference.trim().toUpperCase();
 if(['verified','refund_pending','refunded'].includes(row.state)){
  if(row.transaction_reference!==ref)throw new ToolError('This advance was already verified with another reference.');
  return {verified:true,replayed:true,refundRequired:row.state==='refund_pending'};
 }
 if(!['requested','claimed','pay_at_shop'].includes(row.state))throw new ToolError('This advance is not awaiting verification.');
 const refundRequired=row.acceptance==='rejected'||['cancelled','collected'].includes(row.fulfillment);
 const duplicate=await client.query('SELECT id FROM order_advances WHERE transaction_reference=$1 AND id<>$2',[ref,row.id]);
 if(duplicate.rowCount)throw new ToolError('That transaction reference is already assigned to another order.');
 await client.query("UPDATE order_advances SET state=$4,transaction_reference=$1,verified_by=$2,verified_at=now(),updated_at=now() WHERE id=$3",[ref,actor,row.id,refundRequired?'refund_pending':'verified']);
 if(row.state==='pay_at_shop')await client.query('UPDATE order_requests SET advance_required=true WHERE store_id=$1 AND id=$2',[storeId,requestId]);
 // This is an advance, not payment of the full bill or acceptance by the shop.
 if(!refundRequired)await client.query("UPDATE order_requests SET payment='pending' WHERE store_id=$1 AND id=$2",[storeId,requestId]);
 return {verified:true,replayed:false,refundRequired};
}
export const paymentClaimText=(text:string)=>/^(?:(?:i\s+)?(?:have\s+)?paid|payment\s+(?:done|paid)|pay\s+panni(?:tten|tteen)|pay\s*பண்ணிட்டேன்|பணம்\s*(?:அனுப்பிட்டேன்|செலுத்திட்டேன்))[.!\s]*$/iu.test(text.trim());
export const demoPayAtShopText=(text:string)=>/^(?:i(?:'ll| will) pay (?:the )?(?:full (?:amount|bill)|everything) (?:at|in) (?:the )?(?:shop|store)|கடைல(?:யே)?\s*(?:முழு\s*)?(?:பணம்|காசு)\s*தர்றேன்|kadai(?:yi)?la\s+(?:muzhu\s+)?panam\s+tharen)[.!\s]*$/iu.test(text.trim());

export async function verifyManualRefund(client:PoolClient,storeId:string,requestId:string,reference:string) {
 if(!/^[a-zA-Z0-9][a-zA-Z0-9 -]{5,79}$/.test(reference))throw new ToolError('Enter the actual refund transaction reference after sending the refund.');
 const row=(await client.query('SELECT * FROM order_advances WHERE store_id=$1 AND request_id=$2 FOR UPDATE',[storeId,requestId])).rows[0];
 if(!row||!['refund_pending','refunded'].includes(row.state))throw new ToolError('This advance is not awaiting a refund.');
 const ref=reference.trim().toUpperCase();
 if(row.state==='refunded'){if(row.refund_reference!==ref)throw new ToolError('A different refund is already recorded.');return {refunded:true,replayed:true};}
 await client.query("UPDATE order_advances SET state='refunded',refund_reference=$1,updated_at=now() WHERE id=$2",[ref,row.id]);
 return {refunded:true,replayed:false};
}

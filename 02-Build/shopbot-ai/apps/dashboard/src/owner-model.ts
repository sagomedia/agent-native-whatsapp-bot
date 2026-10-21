import type {Product} from '../../../packages/contracts/index.js';
import {normalize, tokens, oneEdit} from '../../../packages/contracts/catalog-text.js';

export type OwnerProduct = Product & {active: boolean; origin: string; inventoryUpdatedAt: string | null};
export type RequestState = {acceptance: string; fulfillment: string;advance_required?:boolean;advance_state?:string};
export const ownerViews = ['overview', 'requests', 'conversations', 'catalog', 'connections', 'message-review'] as const;
export type OwnerView = typeof ownerViews[number];
export const viewLabels: Record<OwnerView, string> = {
  overview: 'Today', conversations: 'Messages', requests: 'Orders', catalog: 'Products', connections: 'Settings & usage', 'message-review':'Message review'
};
export const viewDescriptions:Record<OwnerView,string>={overview:'Orders and customer help, in one place.',requests:'Check requests, send quotes and prepare pickups.',conversations:'Read the request, help the customer and keep the order moving.',catalog:'Shop prices, available stock and the details customers need.',connections:'Your connection, assistant controls and recorded costs.','message-review':'Check the messages your customers see.'};
export function ownerView(value: string | null): OwnerView {
  return ownerViews.includes(value as OwnerView) ? value as OwnerView : 'overview';
}
export function matchesProduct(product: OwnerProduct, query: string) {
  const search = normalize(query);
  if (!search) return true;
  const text = [product.name, product.sku, product.brand ?? '', ...Object.values(product.localNames ?? {}),
    ...product.aliases, ...(product.keywords ?? []), ...Object.values(product.specifications ?? {})].join(' ');
  return normalize(text).includes(search) || tokens(search).every(word => tokens(text).some(candidate => oneEdit(word, candidate)));
}
export function inventoryMatches(product: OwnerProduct, visibility: string, stock: string) {
  if (visibility === 'visible' && !product.active || visibility === 'draft' && product.active) return false;
  if (stock === 'unknown' && product.stock !== null || stock === 'out' && product.stock !== 0) return false;
  return true;
}
export function stockLabel(product: Pick<OwnerProduct, 'stock' | 'unit'>) {
  return product.stock === null ? 'Stock not entered' : product.stock === 0 ? 'Out of stock' : `${product.stock} ${product.unit}`;
}
export function activeRequest(request: RequestState) {
  return request.acceptance === 'awaiting_approval' || request.acceptance === 'accepted' && !['collected', 'cancelled'].includes(request.fulfillment);
}
export function requestLabel(request: RequestState) {
  if (request.acceptance === 'rejected') return 'Declined';
  if (request.fulfillment === 'cancelled') return 'Cancelled';
  if (request.fulfillment === 'collected') return 'Collected';
  if (request.acceptance === 'awaiting_approval') return request.advance_required&&request.advance_state!=='verified'?'Awaiting advance check':'New';
  if (request.fulfillment === 'ready_for_pickup') return 'Ready for pickup';
  if (request.acceptance === 'accepted') return 'Preparing';
  return request.acceptance.replaceAll('_', ' ');
}
export function customerLabel(actor: string | undefined, id: string) {
  // The owner snapshot contains no saved customer display names or phone numbers.
  return actor === 'local-simulator' ? 'Demo shopper' : `Customer · ${id.slice(0, 8)}`;
}
export function replyWindowOpen(lastInbound: string | null | undefined, now = Date.now()) {
  if (!lastInbound) return false;
  const received = new Date(lastInbound).getTime();
  return Number.isFinite(received) && received <= now && now - received < 24 * 3600000;
}
export const when = (value: string) => new Intl.DateTimeFormat('en-IN', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value));
export const day = (value: string) => new Intl.DateTimeFormat('en-IN', {dateStyle: 'medium'}).format(new Date(value));
export const clockTime = (value: string) => new Intl.DateTimeFormat('en-IN', {timeStyle: 'short'}).format(new Date(value));
export const usd = (micros: string | number, exact = false) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: exact ? 6 : 2, maximumFractionDigits: exact ? 6 : 2
}).format(Number(micros) / 1000000);
export function microCurrency(micros:string|null,currency:string|null) {
  if(micros===null||currency===null||!/^\d+$/.test(micros)||!/^[A-Z]{3}$/.test(currency))return 'Amount unavailable';
  const amount=BigInt(micros),whole=amount/1000000n,fraction=(amount%1000000n).toString().padStart(6,'0');
  return new Intl.NumberFormat('en-IN',{style:'currency',currency,minimumFractionDigits:6,maximumFractionDigits:6}).formatToParts(whole).map(part=>part.type==='fraction'?fraction:part.value).join('');
}
export const channelLabels: Record<string, string> = {
  not_connected: 'Not connected', awaiting_verification: 'Awaiting verification',
  webhook_verified: 'Connected · awaiting first message', receiving: 'Receiving test events', attention_required: 'Needs attention'
};
export const auditLabels: Record<string, string> = {
  catalog_product: 'Product updated', catalog_photo: 'Product photo updated',
  request_decision: 'Request decision saved', request_fulfillment: 'Pickup status updated',
  conversation_control: 'Conversation handling changed', manual_reply: 'Shop reply queued', store_pause: 'Assistant control changed'
};

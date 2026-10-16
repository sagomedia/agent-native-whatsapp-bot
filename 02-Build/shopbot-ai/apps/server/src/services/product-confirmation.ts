import {createHash} from 'node:crypto';
import type {DraftLine,Product} from '../../../../packages/contracts/index.js';

export function productIdentity(product:Product) {
  return createHash('sha256').update(JSON.stringify([product.sku,product.version,product.name,product.unit,product.localNames??null,product.imageUrl??null,product.brand??null,product.familyId??null,product.specifications??null,product.quantityStep,product.sellingPolicy??null])).digest('hex');
}
export function productConfirmed(line:DraftLine,product=line.candidates?.find(p=>p.sku===line.sku)) {
  return !!product&&line.productConfirmation?.sku===product.sku&&line.productConfirmation.version===product.version&&line.productConfirmation.identityHash===productIdentity(product);
}
export function preserveConfirmation(old:DraftLine,next:DraftLine) {
  const product=next.candidates?.find(p=>p.sku===next.sku);
  if(product&&productConfirmed(old,product))next.productConfirmation=old.productConfirmation;
  return next;
}
export function markProductConfirmed(line:DraftLine,product:Product) {
  line.productConfirmation={sku:product.sku,version:product.version,identityHash:productIdentity(product)};
}

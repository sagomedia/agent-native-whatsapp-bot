import {stockMilli,stockDecimal} from '../../../packages/contracts/stock-quantity.js';
export type StockTask='restock'|'sale'|'count';
export function stockChangePreview(product:{stockOnHand?:number|null;stockReserved?:number;quantityStep:number},kind:StockTask,quantity:string){
 try{
  const amount=stockMilli(quantity.trim()),held=stockMilli(product.stockReserved??0);
  if(amount>999999999000n)throw new Error('Quantity is too large.');
  if(kind!=='count'&&amount===0n)throw new Error('Enter a quantity above zero.');
  if(amount%stockMilli(product.quantityStep)!==0n)throw new Error('Use this product’s selling increment.');
  if(product.stockOnHand==null&&kind!=='count')throw new Error('Count the shelf first; the current stock is unknown.');
  const before=stockMilli(product.stockOnHand??0),after=kind==='count'?amount:kind==='restock'?before+amount:before-amount;
  if(after<held)throw new Error('This count would use stock held for customer orders. Check those orders first.');
  return {onHand:Number(stockDecimal(after)),reserved:Number(stockDecimal(held)),available:Number(stockDecimal(after-held)),error:''};
 }catch(error){return {onHand:null,reserved:null,available:null,error:quantity.trim()?(error as Error).message:''};}
}

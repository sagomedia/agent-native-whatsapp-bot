/** Inventory is stored with at most three decimal places, calculated as exact milliunits. */
export function stockMilli(value:number|string):bigint {
 const text=typeof value==='number'?String(value):value;
 if(!/^\d+(?:\.\d{1,3})?$/.test(text))throw new Error('Enter a non-negative stock quantity with at most three decimal places.');
 const [whole,fraction='']=text.split('.');
 return BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0'));
}
export function stockDecimal(value:bigint):string {
 const sign=value<0n?'-':'';if(value<0n)value=-value;
 return sign+String(value/1000n)+'.'+String(value%1000n).padStart(3,'0');
}
export function availableStock(onHand:number|string|null,reserved:number|string=0):number|null {
 return onHand===null?null:Number(stockDecimal(stockMilli(onHand)-stockMilli(reserved)));
}

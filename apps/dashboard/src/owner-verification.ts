export type Verification={identity:boolean;photo:boolean;sellingUnit:boolean;price:boolean;stock:boolean};
export const unchecked=():Verification=>({identity:false,photo:false,sellingUnit:false,price:false,stock:false});
/** Invalidate only evidence affected by the edited fact. Search aliases do not change shelf facts. */
export function verificationAfterEdit(current:Verification,key:string):Verification {
 const affected:Record<string,(keyof Verification)[]>={
  name:['identity','photo','sellingUnit','price','stock'],brand:['identity','photo','sellingUnit','price','stock'],specs:['identity','photo','sellingUnit','price','stock'],
  unit:['sellingUnit','price','stock'],quantityStep:['sellingUnit'],saleMode:['sellingUnit','price','stock'],packValue:['identity','photo','sellingUnit','price','stock'],packUnit:['identity','photo','sellingUnit','price','stock'],cutAllowed:['sellingUnit'],continuousLength:['sellingUnit'],
  price:['price'],priceStatus:['price'],stock:['stock'],photo:['photo'],ta:['identity'],latin:['identity'],aliases:['identity'],keywords:['identity'],familyId:['identity'],newType:['identity']
 };
 return {...current,...Object.fromEntries((affected[key]??[]).map(fact=>[fact,false]))};
}

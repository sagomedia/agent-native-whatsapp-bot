// Per-document memory only: the configured shop is fixed by the authenticated host.
// Never persist private owner records in browser storage.
const records=new Map<string,{data:unknown;at:number}>();
let generation=0;
export const ownerReadGeneration=()=>generation;
export function cachedOwnerRead<T>(key:string,maxAgeMs=60000):T|undefined{
 const item=records.get(key);if(!item)return undefined;
 if(Date.now()-item.at>maxAgeMs){records.delete(key);return undefined;}
 records.delete(key);records.set(key,item);return item.data as T;
}
export function rememberOwnerRead(key:string,data:unknown,expectedGeneration=generation){
 if(expectedGeneration!==generation)return;
 records.delete(key);records.set(key,{data,at:Date.now()});
 while(records.size>32)records.delete(records.keys().next().value!);
}
export function invalidateOwnerReads(){generation++;records.clear();}

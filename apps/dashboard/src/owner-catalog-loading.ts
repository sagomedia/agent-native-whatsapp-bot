/** Abort superseded reads and ignore late results even if a loader ignores abort. */
export function latestCatalogRead(){
 let generation=0,controller:AbortController|undefined;
 return {cancel(){generation++;controller?.abort();controller=undefined;},async run<T>(load:(signal:AbortSignal)=>Promise<T>,apply:(value:T)=>void,fail:(error:Error)=>void){controller?.abort();const active=controller=new AbortController(),current=++generation;try{const result=await load(active.signal);if(current===generation&&!active.signal.aborted)apply(result);}catch(e){if(current===generation&&!active.signal.aborted)fail(e as Error);}}};
}

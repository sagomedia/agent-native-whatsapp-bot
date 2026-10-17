/** Discard late reads when a newer search/selection or an unmount supersedes them. */
export function latestCatalogRead(){
 let generation=0;
 return {cancel(){generation++;},async run<T>(load:()=>Promise<T>,apply:(value:T)=>void,fail:(error:Error)=>void){const current=++generation;try{const result=await load();if(current===generation)apply(result);}catch(e){if(current===generation)fail(e as Error);}}};
}

import type {PoolClient} from 'pg';
import type {DiscoveryResult,Operation,ProductIntent} from '../../../../packages/contracts/index.js';
import {discoverProducts} from './catalog-discovery.js';
import {ToolError,type ActorContext} from './context.js';

export function validateProductMeaningEvidence(operations:Operation[],description:string):Operation[] {
  for(const op of operations){
    if((op.kind==='add_item'||op.kind==='resolve_line')&&op.productIntent&&!description.includes(op.productIntent.sourcePhrase))throw new ToolError('The proposed product meaning has no supporting phrase in your message. Please describe the item again.','interpretation_evidence');
  }
  return operations;
}

// Predictions remain distinct until the customer chooses a product type. Each
// alternative uses ordinary catalog identity checks and real family metadata.
export async function discoverProductMeanings(client:PoolClient,ctx:ActorContext,query:string,intent:ProductIntent):Promise<DiscoveryResult> {
  if(intent.kind!=='ambiguous'||!intent.alternatives)throw new ToolError('Product type alternatives are missing.');
  const ids=intent.alternatives.map(a=>a.familyId);
  const families=(await client.query('SELECT id,label,local_names FROM catalog_nodes WHERE store_id=$1 AND kind=\'family\' AND id=ANY($2::text[])',[ctx.storeId,ids])).rows;
  if(families.length!==ids.length)throw new ToolError('The proposed product types are outside this shop’s catalog.');
  const results:DiscoveryResult[]=[];
  for(const alternative of intent.alternatives)results.push(await discoverProducts(client,ctx,alternative.query,{keywords:[alternative.query],familyId:alternative.familyId,...(intent.useCase?{useCase:intent.useCase}:{})}));
  const products=results.flatMap(r=>r.products.slice(0,1));
  return {query,plan:{keywords:intent.alternatives.map(a=>a.query),familyIds:ids,...(intent.useCase?{useCase:intent.useCase}:{})},products,rankings:results.flatMap(r=>r.rankings.filter(rank=>products.some(p=>p.sku===rank.sku))),totalCount:results.reduce((n,r)=>n+r.totalCount,0),retrievedCount:products.length,noExactMatch:true,facets:[{key:'family',label:'product type',values:ids.map((id,n)=>{const family=families.find(f=>f.id===id)!;return {value:id,label:family.label,localNames:family.local_names,count:results[n].totalCount};})}]};
}

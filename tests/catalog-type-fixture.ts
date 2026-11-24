import {randomUUID} from 'node:crypto';
import type {ConversationState,DiscoveryPlan,DiscoveryResult,DraftLine,Product} from '../packages/contracts/index.js';
export const typePlan:DiscoveryPlan={keywords:['pipe'],clarifyType:true,familyIds:['pvc-pipes','hose']};
export function categoryState(state:ConversationState):ConversationState {
 const line=state.draft[0];
 const examples:Product[]=[['P','PVC pipe','pvc-pipes'],['H','Garden hose','hose']].map(([sku,name,familyId])=>({sku,name,familyId,unit:'piece',pricePaise:100,stock:10,version:1,aliases:[],quantityStep:1,imageUrl:'/demo-images/H01.jpg'}));
 const discovery:DiscoveryResult={query:line.query??line.name,plan:typePlan,products:[],rankings:[],totalCount:2,retrievedCount:0,noExactMatch:true,matchStatus:'needs_detail',groups:examples.map(p=>({key:'family',value:p.familyId!,label:p.name,count:1,product:p})),facets:[]};
 line.discovery=discovery;state.pending={kind:'products',id:randomUUID(),version:state.version,expiresAt:new Date(Date.now()+60000).toISOString(),remaining:1,groups:[{lineId:line.id,products:[],discovery}]};
 return state;
}

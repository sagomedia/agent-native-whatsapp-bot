import {say,safeQuestion} from '../../../../packages/contracts/language.js';
import type {ConversationState,DiscoveryResult,Product} from '../../../../packages/contracts/index.js';

export function differenceLabel(result:DiscoveryResult|undefined,sku:string,state:ConversationState):string|undefined {
 const differences=result?.rankings.find(r=>r.sku===sku)?.differences;
 if(!differences?.length)return;
 return differences.map(d=>say(state,`${d.field}: ${d.actual??'not verified'}; requested ${d.requested}`,`${d.field}: ${d.actual??'உறுதி செய்யவில்லை'}; கேட்டது ${d.requested}`,`${d.field}: ${d.actual??'confirm aagala'}; kettathu ${d.requested}`)).join(' · ');
}

/** Ask for an attribute only when the visible catalog choices differ on it. */
export function catalogQuestion(question:string|undefined,state:ConversationState,products:Product[]):string|undefined {
 const safe=safeQuestion(question,state);if(!safe||!products.length)return safe;
 const brand=/\bbrand\b|பிராண்ட்/iu.test(safe),colour=/\bcolou?r\b|நிறம்/iu.test(safe);
 const known=brand?products.map(p=>p.brand):colour?products.map(p=>p.specifications?.colour??p.specifications?.color):undefined;
 if(known?.every(Boolean)&&new Set(known.map(v=>v!.toLowerCase())).size===1)return;
 return safe;
}

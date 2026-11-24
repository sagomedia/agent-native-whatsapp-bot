import type {ConversationState,DraftLine} from '../../../../packages/contracts/index.js';
import type {TurnUnderstanding} from '../../../../packages/contracts/understanding.js';
import {normalize,tokens} from '../../../../packages/contracts/catalog-text.js';
import {withoutCatalogMeasurements} from '../../../../packages/contracts/catalog-measurements.js';
import {editMeasuresMatch} from '../adapters/mention-reconciliation.js';

const words=(value:string)=>tokens(withoutCatalogMeasurements(value)).filter(w=>!/^\d/.test(w));
function names(line:DraftLine){
 const product=line.candidates?.find(p=>p.sku===line.sku);
 return [line.query,line.name,line.sku,product?.name,...product?.aliases??[],...Object.values(product?.localNames??{})].filter((v):v is string=>!!v);
}
/** Compare the normalized semantic target with live cart/catalog identities.
 * Literal mentions of another current item still prevent a model UUID override.
 * There is no store/product noun dictionary in this binding path. */
export function inventoryEditTargets(edit:TurnUnderstanding['proposedEdits'][number],state:ConversationState):DraftLine[]{
 const query=edit.targetQuery;if(!query)return [];
 const wanted=words(query);
 const canonical=state.draft.filter(line=>names(line).some(name=>normalize(name)===normalize(query)||wanted.length>0&&wanted.every(w=>words(name).includes(w))));
 const source=words(edit.sourceText);
 const literal=state.draft.filter(line=>names(line).some(name=>{
  const identity=words(name);return identity.length>0&&identity.every(w=>source.includes(w));
 }));
 const scope=literal.length?canonical.filter(line=>literal.some(other=>other.id===line.id)):canonical;
 return scope.filter(line=>edit.kind==='replace'||edit.kind==='set_amount'||edit.kind==='increment_amount'||editMeasuresMatch(edit.sourceText,line));
}

import type {DiscoveryFacet,ConversationState} from '../../../../packages/contracts/index.js';
import {discoveryMoreValue} from '../../../../packages/contracts/discovery.js';
import {localName,say} from '../../../../packages/contracts/language.js';
/** At most three WhatsApp buttons, including continuation when available. */
export function discoveryFacetChoices(facet:DiscoveryFacet,state:ConversationState):{label:string;value:string}[]{
 return [...facet.values.map(v=>({label:localName(v.label,v.localNames,state),value:v.value})),...(facet.nextOffset!==undefined?[{label:say(state,'More choices','மேலும் தேர்வுகள்','Melum choices'),value:discoveryMoreValue}]:[])];
}

import type {ConversationState,DraftLine} from '../../../../packages/contracts/index.js';
import {fitText} from '../../../../packages/contracts/channel-text.js';
import {lineName,say,unitName} from '../../../../packages/contracts/language.js';

type CartSnapshot=Pick<ConversationState,'draft'|'replyLanguage'>;
type Change={kind:'added'|'removed'|'changed';line:DraftLine;detail?:string};

const measure=(value:number,unit:string,state:CartSnapshot)=>`${value} ${unitName(unit,state,value)}`;

function amount(line:DraftLine,state:CartSnapshot):string|undefined {
 if(line.requestedAmount){
  const measured=measure(line.requestedAmount.value,line.requestedAmount.unit,state);
  const continuous=line.amountMode==='continuous';
  return say(state,`requested ${measured}${continuous?' in one continuous length':''}`,`கேட்ட அளவு ${measured}${continuous?' ஒரே நீளமாக':''}`,`ketta alavu ${measured}${continuous?' ore neelamaaga':''}`);
 }
 if(line.quantity!==null)return measure(line.quantity,line.unit??line.requestedUnit??'unit',state);
 if(line.requestedQuantity!==undefined)return say(state,`requested ${measure(line.requestedQuantity,line.requestedUnit??'unit',state)}`,`கேட்டது ${measure(line.requestedQuantity,line.requestedUnit??'unit',state)}`,`kettathu ${measure(line.requestedQuantity,line.requestedUnit??'unit',state)}`);
}

function changed(before:DraftLine,after:DraftLine):boolean {
 return before.sku!==after.sku||before.query!==after.query||before.name!==after.name||
  before.quantity!==after.quantity||before.unit!==after.unit||before.requestedUnit!==after.requestedUnit||
  before.requestedQuantity!==after.requestedQuantity||before.requestedAmount?.value!==after.requestedAmount?.value||
  before.requestedAmount?.unit!==after.requestedAmount?.unit||before.amountMode!==after.amountMode;
}

function detail(before:DraftLine,after:DraftLine,state:CartSnapshot):string|undefined {
 const amountChanged=before.requestedAmount?.value!==after.requestedAmount?.value||before.requestedAmount?.unit!==after.requestedAmount?.unit||before.amountMode!==after.amountMode;
 const countChanged=before.quantity!==after.quantity||before.unit!==after.unit||before.requestedQuantity!==after.requestedQuantity||before.requestedUnit!==after.requestedUnit;
 if(!amountChanged&&!countChanged)return;
 const next=amount(after,state);
 if(amountChanged&&after.requestedAmount)return next;
 if(!amountChanged&&after.requestedAmount){
  if(after.quantity===null)return say(state,'list count to confirm','பட்டியல் எண்ணிக்கை சரிபார்க்க வேண்டும்','list count confirm pannanum');
  const count=measure(after.quantity,after.unit??'unit',state);
  return say(state,`list count ${count}`,`பட்டியல் எண்ணிக்கை ${count}`,`list count ${count}`);
 }
 if(!next)return say(state,'count to confirm','எண்ணிக்கை சரிபார்க்க வேண்டும்','count confirm pannanum');
 return next;
}

function fragment(change:Change,state:CartSnapshot,maxNameLength=70):string {
 const name=fitText(lineName(change.line,state).replace(/\s+/g,' ').trim(),maxNameLength);
 if(change.kind==='removed')return say(state,`Removed ${name}`,`${name} நீக்கப்பட்டது`,`${name} remove panniyachu`);
 if(change.kind==='added'&&!change.line.sku&&change.line.resolution!=='matched')return say(state,`Saved request for ${name}${change.detail?` (${change.detail})`:''}; product still needs checking`,`${name} கோரிக்கை வைத்துள்ளேன்; பொருளைச் சரிபார்க்க வேண்டும்`,`${name} request vechchirukken; porulai check pannanum`);
 if(change.kind==='added')return say(state,`Added ${name}${change.detail?` (${change.detail})`:''}`,`${name} சேர்க்கப்பட்டது${change.detail?` (${change.detail})`:''}`,`${name} serththaachu${change.detail?` (${change.detail})`:''}`);
 return say(state,`Changed ${name}${change.detail?` (${change.detail})`:''}`,`${name} மாற்றப்பட்டது${change.detail?` (${change.detail})`:''}`,`${name} maaththiyaachu${change.detail?` (${change.detail})`:''}`);
}

/** A factual, optional context line for a successfully committed cart mutation. */
export function cartChangeFeedback(before:CartSnapshot,after:CartSnapshot,maxNameLength=70):string|undefined {
 const old=new Map(before.draft.map(line=>[line.id,line]));
 const current=new Map(after.draft.map(line=>[line.id,line]));
 const changes:Change[]=[];
 for(const line of before.draft)if(!current.has(line.id))changes.push({kind:'removed',line});
 for(const line of after.draft){
  const prior=old.get(line.id);
  if(!prior)changes.push({kind:'added',line,detail:amount(line,after)});
  else if(changed(prior,line))changes.push({kind:'changed',line,detail:detail(prior,line,after)});
 }
 if(!changes.length)return;
 // The name and amount are more useful than a bare item count, but a compound
 // change must still fit beside the next question in one WhatsApp message.
 const shown:string[]=[];
 for(const change of changes){
  const candidate=fragment(change,after,maxNameLength);
  if(shown.length===3||candidate.length>170||[...shown,candidate].join('; ').length>185)break;
  shown.push(candidate);
 }
 if(!shown.length)return say(after,`${changes.length} ${changes.length===1?'item updated':'items updated'} in your list`, `பட்டியலில் ${changes.length} பொருள் மாற்றப்பட்டது`, `List-la ${changes.length} porul maaththiyaachu`);
 const remaining=changes.length-shown.length;
 const suffix=remaining?say(after,`${remaining} more ${remaining===1?'change':'changes'}`,`மேலும் ${remaining} மாற்றம்`, `innum ${remaining} maaththam`):'';
 const result=[...shown,suffix].filter(Boolean).join('; ');
 return result||say(after,`${changes.length} ${changes.length===1?'item changed':'items changed'} in your list`, `பட்டியலில் ${changes.length} பொருள் மாற்றப்பட்டது`, `List-la ${changes.length} porul maaththiyaachu`);
}

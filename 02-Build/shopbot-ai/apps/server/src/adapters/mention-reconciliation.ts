import type {ConversationState,DraftLine} from '../../../../packages/contracts/index.js';
import type {TurnUnderstanding} from '../../../../packages/contracts/understanding.js';
import {normalize,tokens} from '../../../../packages/contracts/catalog-text.js';
import {say,lineName} from '../../../../packages/contracts/language.js';
import {matchesProductMeasures,spokenMeasures,convertAmount,catalogPack,catalogMeasures,explicitPurchaseCount} from '../services/quantity-evidence.js';
type Item=TurnUnderstanding['requestedItems'][number];
import {additionalMention,repeatMention,correctionMention,currentItemMention} from '../../../../packages/contracts/intent-language.js';
export {additionalMention} from '../../../../packages/contracts/intent-language.js';
function identity(query:string){return tokens(normalize(query).replace(/\bhose\s+pipe\b/g,'hose').replace(/\b\d+(?:\.\d+)?\s*(?:inch|inches|mm|cm|ml|litre|litres|kg|metre|metres|m)\b/g,' ')).join(' ');}
// These nouns name several physically different shop products. A one-word
// mention does not identify a previously selected type by itself.
const ambiguousHeads=new Set(['pipe','tube','hose']);
function ambiguousIdentity(query:string){const words=identity(query).split(' ');return words.length===1&&ambiguousHeads.has(words[0]);}
function refersToCurrentItem(item:Item,state:ConversationState,line:DraftLine){
 return repeatMention.test(item.sourceText)||correctionMention.test(item.sourceText)||currentItemMention.test(item.sourceText)||state.editingLineId===line.id||state.pending?.kind==='question'&&state.pending.lineId===line.id||state.pending?.kind==='products'&&state.pending.groups.length===1&&state.pending.groups[0].lineId===line.id;
}
export function sameMention(a:string,b:string){
 const left=identity(a),right=identity(b);if(!left||!right)return false;
 if(left===right)return true;
 const l=left.split(' '),r=right.split(' ');
 return (l.length===1||r.length===1)&&l.at(-1)===r.at(-1);
}
// Include the spoken count and referential wording omitted by a terse sourceText.
// The result is always one literal substring, never reconstructed evidence.
export function mentionClause(source:string,phrase:string){
 if(explicitPurchaseCount(phrase)!==undefined)return phrase;
 const pieces=source.split(/[,;\n]|[.!?](?:\s|$)|\b(?:and|plus|next|then|aduthu|appuram)\b|அடுத்து|அப்புறம்|அதுக்கப்புறம்|அண்ட்|நெக்ஸ்ட்/iu);
 const hits=pieces.filter(p=>p.includes(phrase)),clause=hits[0]?.trim();return clause&&clause.length<=500?clause:phrase;
}
function compatibleItems(a:Item,b:Item){
 if(!a.query||!b.query||!sameMention(a.query,b.query))return false;
 for(const field of ['brand','colour','material'] as const)if(a[field]&&b[field]&&normalize(a[field]!)!==normalize(b[field]!))return false;
 if(a.packSize&&b.packSize&&convertAmount(b.packSize,a.packSize.unit)!==a.packSize.value)return false;
 for(const m of a.dimensions??[])for(const n of b.dimensions??[])if(m.role===n.role&&convertAmount(n,m.unit)!==m.value)return false;
 if(a.targetLineId&&b.targetLineId&&a.targetLineId!==b.targetLineId)return false;
 return true;
}
// Attribute prefix/postfix counts across punctuation-free speech jointly.
// A literal gap cannot supply two items' counts. If two assignments remain
// possible, ask for a correction instead of borrowing a neighbouring count.
function boundedClauses(items:Item[],source:string){
 const spans=items.map(i=>({start:source.indexOf(i.sourceText),end:source.indexOf(i.sourceText)+i.sourceText.length}));
 if(spans.some((s,n)=>s.start<0||source.lastIndexOf(items[n].sourceText)!==s.start||n>0&&s.start<spans[n-1].end))return null;
 let changed=false;
 const candidates=items.map((item,n)=>{
  const span=spans[n],clause=mentionClause(source,item.sourceText);
  if(explicitPurchaseCount(item.sourceText)!==undefined||item.purchaseCount===null||!items.some((other,j)=>j!==n&&clause.includes(other.sourceText)))return [span];
  const prefix={start:spans[n-1]?.end??0,end:span.end},suffix={start:span.start,end:spans[n+1]?.start??source.length};
  const count=(s:{start:number;end:number})=>explicitPurchaseCount(source.slice(s.start,s.end));
  if(count(prefix)===undefined&&count(suffix)===undefined)return [span];
  changed=true;
  return [prefix,suffix].filter(s=>s.end-s.start<=500&&count(s)===item.purchaseCount)
   .filter(s=>!(s===suffix&&n+1<items.length&&items[n+1].purchaseCount===null&&explicitPurchaseCount(source.slice(span.end,spans[n+1].end))===item.purchaseCount));
 });
 if(!changed)return null;
 const ways:number[][]=candidates.map(row=>row.map(()=>0));
 for(let n=items.length-1;n>=0;n--)for(let j=0;j<candidates[n].length;j++)ways[n][j]=n===items.length-1?1:Math.min(2,candidates[n+1].reduce((sum,next,k)=>sum+(candidates[n][j].end<=next.start?ways[n+1][k]:0),0));
 if(ways[0].reduce((a,b)=>a+b,0)!==1)throw new Error('Neighbouring item counts need clarification');
 const result:string[]=[];let end=0;
 for(let n=0;n<items.length;n++){const index=candidates[n].findIndex((s,j)=>s.start>=end&&ways[n][j]>0),span=candidates[n][index];result.push(source.slice(span.start,span.end).trim());end=span.end;}
 return result;
}
export function consolidateMentions(items:Item[],source:string,image:boolean):Item[]{
 if(image){if(items.some(i=>i.targetLineId!==undefined||i.sameItemOrdinal!==undefined||i.requestMode==='additional'))throw new Error('Images cannot edit existing lines or consolidate list rows');return items;}
 const result:Item[]=[],references=new Map<number,Item>(),bounded=boundedClauses(items,source);
 for(const [position,raw] of items.entries()){
  let phrase=bounded?.[position]??mentionClause(source,raw.sourceText);
  const start=source.indexOf(raw.sourceText),others=items.filter(other=>other!==raw&&other.sourceText!==raw.sourceText).map(other=>({start:source.indexOf(other.sourceText),end:source.indexOf(other.sourceText)+other.sourceText.length})).filter(other=>other.start>=0);
  // ASR often omits punctuation. Expanding one terse source span must not
  // borrow a different item's count or pack contents from the same clause.
  if(!bounded&&start>=0&&others.some(other=>phrase.includes(source.slice(other.start,other.end)))){
   const next=Math.min(source.length,...others.filter(other=>other.start>=start+raw.sourceText.length).map(other=>other.start));
   phrase=source.slice(start,next).trim();
  }
  const item={...raw,sourceText:phrase};
  // A self-reference says nothing about another row. Some providers include
  // it on an already consolidated item; discard it without changing evidence.
  if(item.sameItemOrdinal===item.ordinal)delete item.sameItemOrdinal;
  const location=source.indexOf(raw.sourceText),context=location<0?'':source.slice(location,location+raw.sourceText.length+70);
  const matches=result.filter(old=>compatibleItems(old,item));
  const old=item.sameItemOrdinal!==undefined?references.get(item.sameItemOrdinal):!additionalMention.test(item.sourceText)&&(repeatMention.test(context)||correctionMention.test(item.sourceText))&&matches.length===1?matches[0]:undefined;
  if(item.sameItemOrdinal!==undefined&&(!old||old.ordinal>=item.ordinal||!compatibleItems(old,item)))throw new Error('Repeated mention must reference a compatible earlier item');
  if(!old){result.push(item);references.set(item.ordinal,item);continue;}
  if(item.requestMode==='additional'||additionalMention.test(item.sourceText))throw new Error('Keep explicitly additional mentions separate from refinements');
  const changedCount=old.purchaseCount!==null&&item.purchaseCount!==null&&old.purchaseCount!==item.purchaseCount;
  if(changedCount&&!correctionMention.test(item.sourceText))throw new Error('Conflicting repeated counts need clarification');
  const dimensions=[...(old.dimensions??[])];for(const d of item.dimensions??[])if(!dimensions.some(m=>m.role===d.role&&convertAmount(d,m.unit)===m.value))dimensions.push(d);
  references.set(item.ordinal,old);
  Object.assign(old,{...item,ordinal:old.ordinal,sourceText:changedCount?item.sourceText:old.sourceText,query:identity(item.query!).split(' ').length>identity(old.query!).split(' ').length?item.query:old.query,purchaseCount:changedCount?item.purchaseCount:old.purchaseCount??item.purchaseCount,targetLineId:old.targetLineId??item.targetLineId,packSize:old.packSize??item.packSize,dimensions:dimensions.length?dimensions:undefined,unresolved:[...new Set([...old.unresolved,...item.unresolved])]});
 }
 return result;
}
export function compatibleLine(item:Item,line:DraftLine){
 const product=line.candidates?.find(p=>p.sku===line.sku);
 if(!item.query||![line.query??line.name,product?.name,product?.familyId?.replaceAll('-',' '),...(product?.aliases??[]),...Object.values(product?.localNames??{})].some(name=>name&&sameMention(item.query!,name)))return false;
 // A shared head noun is insufficient when the new request contains a brand,
 // material or use qualifier. Those words can be in query even when the model
 // leaves the structured fields empty. Keep the old SKU only if its catalog
 // identity actually supports every such word.
 const known=new Set([line.query,line.name,line.sku,product?.name,product?.brand,...(product?.aliases??[]),...(product?.keywords??[]),...Object.values(product?.localNames??{})].filter((name):name is string=>!!name).flatMap(name=>identity(name).split(' ')));
 if(identity(item.query).split(' ').some(word=>!known.has(word)))return false;
 const named=normalize([line.query,line.name,product?.brand,...Object.values(product?.specifications??{})].filter(Boolean).join(' '));
 if([item.brand,item.colour,item.material].some(value=>value&&!named.includes(normalize(value))))return false;
 const dimensions=item.dimensions??spokenMeasures(item.query);
 if(product&&dimensions.length&&!matchesProductMeasures(product,dimensions))return false;
 const pack=line.packSize??(product?catalogPack(product):undefined);
 if(pack&&item.packSize&&convertAmount(item.packSize,pack.unit)!==pack.value)return false;
 return true;
}
// Resolve an edit's spoken name against every old line. A model-chosen ID
// cannot make the shared alias "pipe" identify one of two pipe entries.
// Compare product identity, not the unit/pack words repeated on every card.
const editNoise=new Set(['inch','inches','இன்ச்','இன்சு','mm','cm','metre','meter','litre','kg','piece','box','pack','pcs','pc','set','item','line','entry','product','and','of','the','my','this','that','one','first','second','third','last','எண்ணம்','பீஸ்','பேக்','பெட்டி','லிட்டர்','கிலோ','மீட்டர்','அது','அந்த','இந்த','பொருள்','எல்லாம்','missing','unknown','unavailable']);
function editText(source:string){
 const substitutions:[RegExp,string][]=[[/பிவிசி|பீவிசி|பி\s*வி\s*சி/gu,'PVC'],[/பைப்(?:பு|பை|ப்கள்|களை)?/gu,'pipe'],[/ஸ்க்ரூ\s*டிரைவர்|ஸ்குரு\s*டிரைவர்/gu,'screw driver'],[/ஸ்க்ரூ|ஸ்குரு|திருகு/gu,'screw'],[/போல்ட்(?:டு|டை|டா|களை|கள்)?/gu,'bolt'],[/நட்டு(?:களை|கள்)?/gu,'nut'],[/பிளேயர்|ப்ளையர்|பிளையர்/gu,'plier'],[/கட்டிங்/gu,'cutting'],[/ஸ்விட்ச்|சுவிட்ச்/gu,'switch'],[/சாக்கெட்|சாக்கட்/gu,'socket'],[/பெயிண்ட்|பெயின்ட்/gu,'paint'],[/வயர்/gu,'wire'],[/ஹோஸ்|ஓஸ்/gu,'hose'],[/கார்டன்/gu,'garden']];
 let text=normalize(source).replace(/\bscrewdriver\b/giu,'screw driver');for(const [pattern,replacement] of substitutions)text=text.replace(pattern,replacement);return text;
}
export function editIdentityWords(source:string){return tokens(editText(source)).filter(word=>word.length>2&&!/^\d/.test(word)&&!editNoise.has(word));}
export function editMeasuresMatch(source:string,line:DraftLine):boolean {
 // Recognition sometimes writes the inch abbreviation as "4 in". Normalize
 // it only for edit-size comparison, never for purchase-count extraction.
 const measures=spokenMeasures(source.replace(/\b(\d+(?:\.\d+)?)\s*in\b/giu,'$1 inch')).filter(measure=>['inch','mm','cm','m','foot','litre','ml','kg','g'].includes(measure.unit));
 const product=line.candidates?.find(product=>product.sku===line.sku),known=[...line.productMeasures??[],...(line.packSize?[line.packSize]:[]),...spokenMeasures([line.query,line.name].join(' ')),...(product?catalogMeasures(product):[])];
 return measures.every(measure=>{const comparable=known.filter(value=>convertAmount(value,measure.unit)!==null);return !comparable.length||comparable.some(value=>convertAmount(value,measure.unit)===measure.value);});
}
// A normalized model target may translate a name, but cannot override a
// different product type explicitly named in the current source.
export function editIdentityMatches(source:string,line:DraftLine):boolean {
 const words=new Set(editIdentityWords(source)),product=line.candidates?.find(p=>p.sku===line.sku);
 const primary=editIdentityWords([line.query,line.name,product?.name].filter(Boolean).join(' '));
 const known=new Set(editIdentityWords([line.query,line.name,product?.name,...product?.aliases??[],...Object.values(product?.localNames??{})].filter(Boolean).join(' ')));
 if(words.has('pipe')&&!words.has('hose')&&primary.includes('hose')&&!primary.includes('pipe'))return false;
 if(words.has('screw')&&!words.has('driver')&&primary.includes('driver'))return false;
 const productHeads=new Set(['cutter','brush','blade','wheel','hose','pipe','box','switch','socket']);
 if([...words].some(word=>productHeads.has(word)&&!known.has(word))&&primary.some(word=>productHeads.has(word)))return false;
 // A shared head noun cannot turn a named variant into a different product.
 // For example, "wire cutter" must not select the only "pipe cutter" row.
 // Inspect adjacent words so conversational verbs and quantities are not
 // mistaken for product qualifiers.
 const spoken=editText(source);
 const productQualifiers=new Set(['wire','pipe','paint','garden','water','pvc','steel','plastic','metal','wood','angle','cutting','grinding','screw','gas','electrical']);
 for(const match of spoken.matchAll(/\b([a-z][a-z0-9]*)\s+(cutter|brush|blade|wheel|hose|pipe|box|switch|socket)\b/giu)){
  const modifier=match[1].toLowerCase(),head=match[2].toLowerCase();
  if(known.has(head)&&productQualifiers.has(modifier)&&!known.has(modifier))return false;
 }
 return true;
}
export function namedEditLines(source:string,state:ConversationState,options:{ignoreMeasures?:boolean}={}):DraftLine[]{
 const ordinal=/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|[1-9]|10)(?:st|nd|rd|th)?\s+(?:item|line|product|entry|row)\b/i.exec(source);
 const last=/\blast\s+(?:item|line|product|entry|row)\b|கடைசி(?:யா|யில|யில்)?|லாஸ்ட்(?:டா|டாக)?/iu.test(source);
 const index=ordinal?(({first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10} as Record<string,number>)[ordinal[1].toLowerCase()]??Number(ordinal[1]))-1:last?state.draft.length-1:undefined;
 const text=editText(source),words=new Set(editIdentityWords(source));
 const scored=state.draft.map(line=>{
  const product=line.candidates?.find(p=>p.sku===line.sku);
  const names=[line.query,line.name,line.sku,product?.name,...product?.aliases??[],...Object.values(product?.localNames??{})].filter((n):n is string=>!!n);
  if(!editIdentityMatches(source,line))return {line,score:0};
  const known=new Set(names.flatMap(editIdentityWords)),shared=[...words].filter(word=>known.has(word));
  // An alias consisting only of a size/pack must not identify a product.
  const exact=names.filter(name=>editIdentityWords(name).length&&text.includes(editText(name))).map(name=>editIdentityWords(name).length*100+editText(name).length);
  return {line,score:Math.max(shared.length*10,...exact)};
 });
 const best=Math.max(0,...scored.map(row=>row.score));
 const named=(best?scored.filter(row=>row.score===best).map(row=>row.line):[]).filter(line=>options.ignoreMeasures||editMeasuresMatch(source,line));
 if(index!==undefined){
  const positional=state.draft[index];if(!positional)return [];
  if(named.length)return named.some(line=>line.id===positional.id)?[positional]:[];
  // A pure ordinal can select a row. A product named alongside a conflicting
  // ordinal must be clarified, rather than letting position override identity.
  const remainder=source.replace(ordinal?.[0]??/(?:\blast\s+(?:item|line|product|entry|row)\b|கடைசி(?:யா|யில|யில்)?|லாஸ்ட்(?:டா|டாக)?)/giu,'');
  if(!editIdentityWords(remainder).filter(word=>!['remove','delete','drop','please','change','set','to','make','neekku','நீக்கு','நீக்குங்க','எடுத்துருங்க'].includes(word)).length)return [positional];
 }
 return named;
}
export function existingMention(item:Item,state:ConversationState):{line?:DraftLine;clarify?:string}{
 if(item.targetLineId){
  const line=state.draft.find(l=>l.id===item.targetLineId);if(!line)throw new Error('Repeated item target is not current');
  const focused=state.editingLineId===line.id||state.pending?.kind==='question'&&state.pending.lineId===line.id;
  const compatible=state.draft.filter(l=>compatibleLine(item,l));
  if(!focused&&compatible.length>1)return {clarify:say(state,'Which existing item should receive this change?','ஏற்கனவே உள்ள எந்தப் பொருளுக்கு இந்த மாற்றம் வேண்டும்?','Irukkura entha porulukku intha maaththam venum?')};
  if(!refersToCurrentItem(item,state,line)){
   if(!compatibleLine(item,line))return {};
   if(item.query&&ambiguousIdentity(item.query))return {clarify:say(state,`Do you mean your existing ${lineName(line,state)}, or a different ${item.query}?`,`ஏற்கனவே உள்ள ${lineName(line,state)}-ஐ சொல்கிறீர்களா, வேறு ${item.query} வேண்டுமா?`,`Irukkura ${lineName(line,state)}-a solreengala, vera ${item.query} venuma?`)};
  }
  return {line};
 }
 const lines=state.draft.filter(l=>compatibleLine(item,l));
 if(lines.length>1)return {clarify:say(state,`Which existing item should change: ${lines.map(l=>`${state.draft.indexOf(l)+1}. ${lineName(l,state)}`).join('; ')}?`,`எந்தப் பொருளை மாற்றணும்: ${lines.map(l=>`${state.draft.indexOf(l)+1}. ${lineName(l,state)}`).join('; ')}?`,`Entha porulai maathanum: ${lines.map(l=>`${state.draft.indexOf(l)+1}. ${lineName(l,state)}`).join('; ')}?`)};
 if(lines.length===1&&item.query&&ambiguousIdentity(item.query)&&!refersToCurrentItem(item,state,lines[0]))return {clarify:say(state,`Do you mean your existing ${lineName(lines[0],state)}, or a different ${item.query}?`,`ஏற்கனவே உள்ள ${lineName(lines[0],state)}-ஐ சொல்கிறீர்களா, வேறு ${item.query} வேண்டுமா?`,`Irukkura ${lineName(lines[0],state)}-a solreengala, vera ${item.query} venuma?`)};
 if(!lines.length&&item.query&&correctionMention.test(item.sourceText)&&!additionalMention.test(item.sourceText)){
  const id=state.editingLineId??(state.pending?.kind==='question'?state.pending.lineId:state.pending?.kind==='products'&&state.pending.groups.length===1?state.pending.groups[0].lineId:undefined);
  const focused=state.draft.find(line=>line.id===id);
  if(focused)return {line:focused};
  if(state.draft.length>1)return {clarify:say(state,'Which existing item are you correcting?','ஏற்கனவே உள்ள எந்தப் பொருளைத் திருத்தணும்?','Irukkura entha porulai thiruththanum?')};
 }
 if(!lines.length&&item.query){
  // A correction may change the type entirely. It can replace one clearly
  // referenced pipe line, but a new BSA/pump pipe without correction remains
  // a separate request even when another pipe is already on the list.
  const related=state.draft.filter(line=>{
   const product=line.candidates?.find(p=>p.sku===line.sku);
   return [line.query,line.name,product?.name,...product?.aliases??[]].some(name=>name&&sameMention(item.query!,name))&&refersToCurrentItem(item,state,line);
  });
  if(related.length===1)return {line:related[0]};
  if(related.length>1)return {clarify:say(state,'Which existing item should I change?','ஏற்கனவே உள்ள எந்தப் பொருளை மாற்றணும்?','Irukkura entha porulai maathanum?')};
 }
 return {line:lines[0]};
}

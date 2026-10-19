import type {TurnUnderstanding} from '../../../../packages/contracts/understanding.js';
import {positiveRemoval,mutationNegated} from '../../../../packages/contracts/intent-language.js';

type Edit=TurnUnderstanding['proposedEdits'][number];
const groupCounts:Record<number,string[]>={2:['both','two','இரண்டும்','இரண்டையும்','ரெண்டும்','ரெண்டையும்','ரெண்டே','ரெண்டுமே'],3:['three','மூன்றும்','மூன்றையும்','மூணும்','மூணையும்']};
const glue=new Set(['and','&','please','the','my','this','that','these','those','it','them','items','products','from','cart','list','only','அந்த','இந்த','இதை','அதை','இவையும்','அவையும்','இல்லை','இல்ல','வேண்டாம்','வேணாம்','பட்டியலில்','பட்டியலிலிருந்து','மற்றும்','எனக்கு']);
const actions=new Set(['remove','delete','drop','take','out','எடுத்துருங்க','எடுத்துடுங்க','எடுத்திடுங்க','நீக்குங்க','நீக்கிடுங்க','நீக்கிடுங்கள்','ரிமூவ்','ரிமூவ','டெலீட்','டிலீட்','பண்ணுங்க','செய்யுங்க']);

// Some provider responses retain each verbatim product mention but omit the
// shared predicate from both spans. Bind only a fully covered, coordinated
// removal clause. Extra nouns, other actions, alternatives, conditions, a wrong
// group count or repeated/overlapping mentions cannot borrow its authority.
export function sharedRemovalEvidence(edits:Edit[],source:string):Map<number,string>{
 const result=new Map<number,string>();
 const clauses=source.split(/[;.!?\n]|\s+(?:but|instead|ஆனா|ஆனால்|அடுத்து)\s+/iu).map(value=>value.trim()).filter(Boolean);
 for(const clause of clauses){
  if(clause.length>500||!positiveRemoval(clause,source)||mutationNegated(clause,source))continue;
  const members=edits.map((edit,index)=>({edit,index,start:clause.indexOf(edit.sourceText)})).filter(member=>member.start>=0);
  if(members.length<2||members.some(({edit})=>edit.kind!=='remove_item')||new Set(members.map(({edit})=>edit.targetLineId)).size!==members.length)continue;
  const ordered=members.sort((a,b)=>a.start-b.start);
  if(ordered.some(({edit,start},index)=>clause.indexOf(edit.sourceText,start+1)>=0||index>0&&start<ordered[index-1].start+ordered[index-1].edit.sourceText.length))continue;
  const coordinated=ordered.every(({edit})=>/(?:வும்|உம்)$/u.test(edit.sourceText))||/\band\b|&|மற்றும்/iu.test(clause);
  if(!coordinated)continue;
  let rest='',end=0;
  for(const {edit,start} of ordered){rest+=clause.slice(end,start)+' ';end=start+edit.sourceText.length;}
  rest+=clause.slice(end);
  const words=rest.toLowerCase().replace(/[,:'"“”‘’()—-]/gu,' ').split(/\s+/u).filter(Boolean);
  const counts=new Set(groupCounts[members.length]??[]);
  // Any explicit count must equal the named group. An omitted product leaves
  // an uncovered noun here, so a partial model list cannot borrow the predicate.
  if(!words.every(word=>glue.has(word)||actions.has(word)||counts.has(word)||['all','எல்லாம்','எல்லாவற்றையும்'].includes(word)))continue;
  for(const {index} of members)result.set(index,clause);
 }
 return result;
}

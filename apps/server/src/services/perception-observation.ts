import {createHash} from 'node:crypto';
import {turnUnderstandingSchema,understandingItemSchema,normalizeUnderstandingAbsence} from '../../../../packages/contracts/understanding.js';

export type PerceptionObservation={rawText?:string;sha256:string;bytes:number;oversized:boolean;envelopeValid:boolean;transcript?:string;observedText?:string;rows:{position:number;kind:'item'|'edit';valid:boolean;issues:{path:string;code:string}[]}[]};

// Validate an envelope independently of its rows. This grants no permission to
// execute a subset: all mutations still require the complete strict contract.
export function perceptionEnvelope(value:unknown){
 const raw=normalizeUnderstandingAbsence(value);
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const data=raw as Record<string,unknown>;
 if(!Array.isArray(data.requestedItems)||data.requestedItems.length>50||!Array.isArray(data.proposedEdits)||data.proposedEdits.length>100)return null;
 const result=turnUnderstandingSchema.safeParse({...data,requestedItems:[],proposedEdits:[]});
 return result.success?result.data:null;
}
export function observeUnderstanding(rawText:string):PerceptionObservation {
 const bytes=Buffer.byteLength(rawText),base={sha256:createHash('sha256').update(rawText).digest('hex'),bytes,oversized:bytes>262144,envelopeValid:false,rows:[] as PerceptionObservation['rows']};
 if(base.oversized)return base;
 let value:unknown;try{value=JSON.parse(rawText);}catch{return {...base,rawText};}
 const envelope=perceptionEnvelope(value),raw=normalizeUnderstandingAbsence(value) as Record<string,unknown>|null;
 const rows:PerceptionObservation['rows']=[];
 if(raw&&typeof raw==='object')for(const [key,kind] of [['requestedItems','item'],['proposedEdits','edit']] as const){
  const entries=raw[key];if(!Array.isArray(entries)||entries.length>100)continue;
  entries.forEach((entry,position)=>{
   const parsed=kind==='item'?understandingItemSchema.safeParse(entry):turnUnderstandingSchema.safeParse({...envelope,requestedItems:[],proposedEdits:[entry]});
   rows.push({position,kind,valid:parsed.success,issues:parsed.success?[]:parsed.error.issues.map(i=>({path:i.path.join('.'),code:i.code}))});
  });
 }
 return {...base,rawText,envelopeValid:!!envelope,...(envelope?.transcript?{transcript:envelope.transcript}:{}),...(envelope?.observedText!==undefined?{observedText:envelope.observedText}:{}),rows};
}

import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {RichReply,ConversationState} from '../../../../packages/contracts/index.js';
import {say} from '../../../../packages/contracts/language.js';

const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const storeHoursSchema=z.object({
 timezone:z.string().max(80).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Choose a valid timezone.'),
 opensAt:time,closesAt:time,days:z.array(z.number().int().min(0).max(6)).min(1).max(7)
}).strict().superRefine((v,c)=>{if(v.opensAt===v.closesAt)c.addIssue({code:'custom',message:'Opening and closing times must differ.'});if(new Set(v.days).size!==v.days.length)c.addIssue({code:'custom',message:'Include each opening day once.'});});
export type StoreHours=z.infer<typeof storeHoursSchema>;
export type StoreHoursStatus={status:'open'|'closed'|'not_configured';schedule:StoreHours|null;revision:number;nextOpening:string|null;lastClosing:string|null;closesAt:string|null;basis:'saved_schedule'};

/** Calendar dates are resolved by PostgreSQL in the shop's saved IANA timezone, including overnight shifts. */
export async function readStoreHours(c:PoolClient,storeId:string,at=new Date()):Promise<StoreHoursStatus>{
 const row=(await c.query('SELECT opening_hours,hours_revision FROM stores WHERE id=$1',[storeId])).rows[0];
 const parsed=storeHoursSchema.safeParse(row?.opening_hours);
 if(!parsed.success)return {status:'not_configured',schedule:null,revision:row?.hours_revision??0,nextOpening:null,lastClosing:null,closesAt:null,basis:'saved_schedule'};
 const s=parsed.data;
 const r=(await c.query(`WITH days AS (
 SELECT (($1::timestamptz AT TIME ZONE $2)::date+n) AS day FROM generate_series(-8,8) n
 ), shifts AS (
 SELECT ((day+$3::time) AT TIME ZONE $2) AS opens,
 ((day+CASE WHEN $4::time<$3::time THEN 1 ELSE 0 END+$4::time) AT TIME ZONE $2) AS closes
 FROM days WHERE extract(dow FROM day)::int=ANY($5::int[])
 ) SELECT bool_or(opens<=$1 AND closes>$1) AS open,
 min(opens) FILTER(WHERE opens>$1) AS next_opening,
 max(closes) FILTER(WHERE closes<=$1) AS last_closing,
 max(closes) FILTER(WHERE opens<=$1 AND closes>$1) AS closes_at FROM shifts`,[at,s.timezone,s.opensAt,s.closesAt,s.days])).rows[0];
 const iso=(v:unknown)=>v?new Date(v as string).toISOString():null;
 return {status:r.open?'open':'closed',schedule:s,revision:row.hours_revision,nextOpening:iso(r.next_opening),lastClosing:iso(r.last_closing),closesAt:iso(r.closes_at),basis:'saved_schedule'};
}

export function hoursAnswer(h:StoreHoursStatus,state:Pick<ConversationState,'replyLanguage'>){
 if(!h.schedule)return say(state,'The shop has not set its opening hours yet.','கடை திறக்கும் நேரம் இன்னும் பதிவு செய்யப்படவில்லை.','Kadai thirakkum neram innum padhivu pannala.');
 const at=h.status==='open'?h.closesAt:h.nextOpening;
 const locale=state.replyLanguage==='ta'?'ta-IN':'en-IN';
 const label=at?new Intl.DateTimeFormat(locale,{timeZone:h.schedule.timezone,weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(at)):null;
 return h.status==='open'?say(state,`The shop is open${label?`. Closes ${label}`:''}.`,`கடை திறந்துள்ளது${label?`. மூடும் நேரம்: ${label}`:''}.`,`Kadai thirandhirukku${label?`. Moodum neram: ${label}`:''}.`):say(state,`The shop is closed${label?`. Opens ${label}`:''}.`,`கடை மூடப்பட்டுள்ளது${label?`. அடுத்து திறக்கும் நேரம்: ${label}`:''}.`,`Kadai moodiyirukku${label?`. Aduthu thirakkum neram: ${label}`:''}.`);
}

/** Attach the reopening time once to a bill without changing the order. */
export function appendClosedShopNotice(reply:RichReply,h:StoreHoursStatus,state:Pick<ConversationState,'replyLanguage'>):RichReply{
 if(h.status!=='closed')return reply;
 const note=hoursAnswer(h,state);
 if(reply.text.includes(note))return reply;
 return {...reply,text:reply.text+'\n\n'+note,accessibleText:(reply.accessibleText??reply.text)+'\n\n'+note,parts:reply.parts?.map((part,i)=>i===reply.parts!.length-1?{...part,text:part.text+'\n\n'+note}:part)};
}

// Small explicit language shortcuts save model calls and bind read-only intent.
// They do not infer SKU, size, packaging conversions, or compound shopping edits.
const numbers:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,twenty:20,half:0.5,'ஒன்று':1,'ஒரு':1,'ஒன்னு':1,'ஒண்ணு':1,'மூணு':3,'இரண்டு':2,'ரெண்டு':2,'மூன்று':3,'நான்கு':4,'நாலு':4,'ஐந்து':5,'அஞ்சு':5,'ஆறு':6,'ஏழு':7,'எட்டு':8,'ஒன்பது':9,'பத்து':10,'அரை':0.5,onnu:1,oru:1,ondru:1,rendu:2,irandu:2,moonu:3,moondru:3,naalu:4,naangu:4,anju:5,ainthu:5,aaru:6,ezhu:7,ettu:8,onbathu:9,paththu:10,pathu:10,arai:0.5};
// Tamil voice transcripts can contain incidental speech on either side of a
// complete command. Require the actual Tamil list/clear verb pair, and reject
// quoted examples, questions, negation and any second shopping edit.
// ASR may lengthen the list word's vowels or confuse its lateral consonant.
// Keep the complete list-word + clear-verb grammar; unrelated nouns do not fit.
const tamilClear=/(?:^|\s)(?:பா?ட்டியா?[லள]ை(?:க்|ய|யே)?|பட்டியலாய|பட்டியல்(?: எல்லாம்)?)\s+காலி\s+(?:செய்|செய்யுங்க|செய்யுங்கள்|பண்ணு|பண்ணுங்க)(?=\s|$)/u;
// "No more items, clear everything" is common spoken Tamil/Tanglish. ASR
// sometimes hears எல்லாத்தையும் as எல்லாரும்; this route only offers a clear
// confirmation, so it never erases the cart based on that uncertain wording.
const allChange=/(?:^|\s)(?:எல்லாத்தையும்|எல்லாமே|எல்லாம்|எல்லாரும்|ellaam|ellam|ellathaiyum|ellaarum|everything|all)\s+(?:சேஞ்ச்|மாற்றி|மாத்தி|change|reset)\s+(?:பண்ணிடு|பண்ணிடுங்க|பண்ணு|பண்ணுங்க|விடு|விடுங்க|pannidu|panniru|pannunga|pannidunga|pannu)(?=\s|$)/u;
export function spokenWholeListChange(text:string):boolean {const clean=speechText(text),match=allChange.exec(clean);return !!match&&!quotedOrQuestion.test(text.toLowerCase())&&!clearNegation.test(clean.slice(match.index+match[0].length));}
const allClear=/(?:^|\s)(?:எல்லாத்தையும்|எல்லாமே|எல்லாம்|எல்லாரும்|ellaam|ellam|ellathaiyum|ellaarum|everything|all)\s+(?:கிளியர்|க்ளியர்|clear)\s+(?:பண்ணிடு|பண்ணிடுங்க|பண்ணு|பண்ணுங்க|pannidu|panniru|pannunga|pannidunga|pannu)(?=\s|$)/u;
const clearNegation=/\b(?:don't|dont|not|no|keep|cancel|stop|vendam|venam|illai)\b|do not|வேண்டாம்|வேணாம்|இல்லை|இல்ல|பண்ணாதே|பண்ணாதீங்க|செய்யாதே|செய்யாதீங்க|சொல்லல/u;
const quotedOrQuestion=/[?"“”‘’]|\b(?:example|quote|quoted)\b|உதாரண|என்று|ன்னு|சொன்னா|சொல்லலாமா|செய்யலாமா|பண்ணலாமா|வேண்டுமா/u;
const secondShoppingEdit=/\b(?:add|remove|delete|change|replace|order)\b|சேர்|சேர்க்க|நீக்கு|மாற்று|வாங்க/u;
const speechText=(text:string)=>text.toLowerCase().replace(/[.!?,;:"“”‘’]+/g,' ').replace(/\s+/g,' ').trim();
// A complete spoken command may be followed by acknowledgement/background
// speech. Never extract clearing from a negated or compound shopping command.
const listClear=/(?:^|\s)(?:(?:பட்டியலை|பட்டியலைக்|பட்டியல்|லிஸ்ட்|லிஸ்ட்டை|லிஸ்டை|list)\s+(?:(?:ellam|ellaam|எல்லாம்)\s+)?(?:கிளியர்|க்ளியர்|clear)\s+(?:பண்ண|பண்ணு|பண்ணுங்க|பண்ணிடு|பண்ணிரு|pannu|pannidu|panniru|pannunga)|(?:clear (?:my|the) list|empty my list))(?=\s|$)/u;
function clearMatch(clean:string){return allClear.exec(clean)??tamilClear.exec(clean)??listClear.exec(clean);}
function clearIsNegated(clean:string,match:RegExpExecArray){
 const before=clean.slice(0,match.index).trim(),after=clean.slice(match.index+match[0].length).trim();
 // "No more items" describes shopping, not a negation of the later clear verb.
 return /(?:\b(?:don't|dont|do not|not|never)|பண்ணாதே|செய்யாதே)\s*$/.test(before)||clearNegation.test(after);
}
export function spokenClearCommand(text:string):string|undefined {
 const clean=speechText(text),match=clearMatch(clean);
 if(!match||clearIsNegated(clean,match)||quotedOrQuestion.test(text.toLowerCase()))return;
 const other=clean.slice(0,match.index)+' '+clean.slice(match.index+match[0].length);
 if(secondShoppingEdit.test(other))return;
 if(/^(?:clear|empty) /.test(match[0].trim())){
  const prefix=clean.slice(0,match.index).trim(),rest=clean.slice(match.index+match[0].length).trim();
  if(prefix&&!/^(?:(?:ok|okay|yes|please)\s*)+$/.test(prefix))return;
  if(rest&&!/^(?:(?:please|thanks|okay|ok|yes|ஆமா|ஆமாம்|சரி|aama|sari)(?:\s+(?:please|thanks|okay|ok|yes|ஆமா|ஆமாம்|சரி|aama|sari))*|(?:ஆமா|ஆமாம்|சரி) என்ன வேலையில(?: வேலை)?)$/.test(rest))return;
 }
 return 'clear my list';
}
export function negatedSpokenClear(text:string):boolean {
 const clean=speechText(text).replace(/ப்ப?ட்டியலை/gu,'பட்டியலை'),match=clearMatch(clean);
 return !!match&&(clearIsNegated(clean,match)||quotedOrQuestion.test(text.toLowerCase()));
}
export function quantityReply(text:string):{quantity:number;unit?:string}|undefined {
  const m=/^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|half|ஒன்று|ஒரு|ஒன்னு|ஒண்ணு|இரண்டு|ரெண்டு|மூன்று|மூணு|நான்கு|நாலு|ஐந்து|அஞ்சு|ஆறு|ஏழு|எட்டு|ஒன்பது|பத்து|அரை|onnu|oru|ondru|rendu|irandu|moonu|moondru|naalu|naangu|anju|ainthu|aaru|ezhu|ettu|onbathu|paththu|pathu|arai)(?:\s+(pieces?|pcs|box(?:es)?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?|bottles?|cans?|tins?|buckets?|dabba|dappa|டப்பா|கேன்|வாளி|litres?|liters?|units?|nos|எண்ணம்|பீஸ்|பெட்டி|பெட்டிகள்|பாக்ஸ்|பாட்டில்|பாட்டில்கள்|ரோல்|ரோல்கள்|அடி|மீட்டர்|கிலோ|ஜோடி|பேக்|லிட்டர்|ennam|petti|pettigal|adi|jodi|kilo))?(?:\s+(?:please|வேண்டும்|வேணும்|venum))?[.!?]*$/i.exec(text.trim());
  return m?{quantity:numbers[m[1].toLowerCase()]??Number(m[1]),...(m[2]?{unit:m[2].toLowerCase()}:{})}:undefined;
}
export function priceInquiry(text:string):{query:string;quantity?:number;requestedUnit?:string}|undefined {
  const s=text.toLowerCase().trim().replace(/[.!?]+$/,'')
    .replace(/[.!;]\s*(?:என்|இந்த)\s+பட்டியலை(?:க்)?\s+மாற்ற\s+வேண்டாம்$/u,'')
    .replace(/விலை\s+மட்டும்\s+சொல்லு(?:ங்கள்|ங்க)?$/u,'விலை');
  if(/வேண்டும்|வேணும்|சேர்|நீக்கு|மாற்று|\b(?:venum|seru|neekku|maathu)\b/.test(s))return;
  const native=/^(.+?)\s+(?:விலை(?: என்ன| எவ்வளவு)?|என்ன விலை|எவ்வளவு|vilai(?: enna)?|evlo|price enna)$/.exec(s);
  if(native)return {query:native[1]};
  if(/\b(?:add|remove|change|set|place order|i need|i want|i will take|i'll take)\b/.test(s)||/delivery|shipping|discount|trade (?:price|rate)|plumber rate|best price/.test(s))return;
  const lead=/^(?:(?:what is the |what's the |what is |what's )?(?:price|cost)(?: of| for)?\s+|how much (?:is |are |for |does )?)/.exec(s);
  if(!lead)return;
  let query=s.slice(lead[0].length).trim();if(!query)return;
  let quantity:number|undefined,requestedUnit:string|undefined;
  const amount=/^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|half|ஒன்று|ஒரு|ஒன்னு|ஒண்ணு|இரண்டு|ரெண்டு|மூன்று|மூணு|நான்கு|நாலு|ஐந்து|அஞ்சு|ஆறு|ஏழு|எட்டு|ஒன்பது|பத்து|அரை|onnu|oru|ondru|rendu|irandu|moonu|moondru|naalu|naangu|anju|ainthu|aaru|ezhu|ettu|onbathu|paththu|pathu|arai)\s+(.+)$/.exec(query);
  // A leading size such as 1 inch/25 mm is part of the specification.
  if(amount&&!/^(?:inch(?:es)?|in\b|mm\b|cm\b)/.test(amount[2])) {quantity=numbers[amount[1]]??Number(amount[1]);query=amount[2];}
  const unit=/^(pieces?|pcs|box(?:es)?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?)\s+(?:of\s+)?(.+)$/.exec(query);
  if(unit){requestedUnit=unit[1];query=unit[2]+(/^box/.test(unit[1])?' box':'');}
  else {const tail=/\s+(pieces?|pcs|box(?:es)?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?)$/.exec(query);if(tail){requestedUnit=tail[1];if(!/^box/.test(tail[1]))query=query.slice(0,-tail[0].length);}}
  return {query,...(quantity!==undefined?{quantity}:{}),...(requestedUnit?{requestedUnit}:{})};
}

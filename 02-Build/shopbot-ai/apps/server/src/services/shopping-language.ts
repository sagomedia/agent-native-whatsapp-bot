// Small explicit language shortcuts save model calls and bind read-only intent.
// They do not infer SKU, size, packaging conversions, or compound shopping edits.
const numbers:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,twenty:20,half:0.5,'ஒன்று':1,'ஒரு':1,'ஒன்னு':1,'இரண்டு':2,'ரெண்டு':2,'மூன்று':3,'நான்கு':4,'நாலு':4,'ஐந்து':5,'அஞ்சு':5,'ஆறு':6,'ஏழு':7,'எட்டு':8,'ஒன்பது':9,'பத்து':10,'அரை':0.5,onnu:1,oru:1,ondru:1,rendu:2,irandu:2,moonu:3,moondru:3,naalu:4,naangu:4,anju:5,ainthu:5,aaru:6,ezhu:7,ettu:8,onbathu:9,paththu:10,pathu:10,arai:0.5};
// Tamil voice transcripts can contain incidental speech on either side of a
// complete command. Require the actual Tamil list/clear verb pair, and reject
// quoted examples, questions, negation and any second shopping edit.
// ASR may lengthen the list word's vowels or confuse its lateral consonant.
// Keep the complete list-word + clear-verb grammar; unrelated nouns do not fit.
const tamilClear=/(?:^|\s)(?:பா?ட்டியா?[லள]ை(?:க்|ய|யே)?|பட்டியலாய|பட்டியல்(?: எல்லாம்)?)\s+காலி\s+செய்(?=\s|$)/u;
const clearNegation=/\b(?:don't|dont|not|no|keep|cancel|stop|vendam|venam|illai)\b|do not|வேண்டாம்|வேணாம்|இல்லை|இல்ல|பண்ணாதே|பண்ணாதீங்க|செய்யாதே|செய்யாதீங்க|சொல்லல/u;
const quotedOrQuestion=/[?"“”‘’]|\b(?:example|quote|quoted)\b|உதாரண|என்று|ன்னு|சொன்னா|சொல்லலாமா|செய்யலாமா|பண்ணலாமா|வேண்டுமா/u;
const secondShoppingEdit=/\b(?:add|remove|delete|change|replace|order)\b|சேர்|சேர்க்க|நீக்கு|மாற்று|வாங்க/u;
const speechText=(text:string)=>text.toLowerCase().replace(/[.!?,;:"“”‘’]+/g,' ').replace(/\s+/g,' ').trim();
// A complete spoken command may be followed by acknowledgement/background
// speech. Never extract clearing from a negated or compound shopping command.
export function spokenClearCommand(text:string):string|undefined {
 const clean=speechText(text);
 if(tamilClear.test(clean))return clearNegation.test(clean)||quotedOrQuestion.test(text.toLowerCase())||secondShoppingEdit.test(clean)?undefined:'clear my list';
 const found=/^(?:clear (?:my|the) list|empty my list|(?:பட்டியலை(?:க்|ய)?|பட்டியல்(?: எல்லாம்)?) காலி செய்|list clear pannu)(?:\s|$)/.exec(clean);
 if(!found)return;
 const rest=clean.slice(found[0].length).trim();
 if(/\b(?:don't|dont|not|no|keep|cancel|stop|vendam|venam|illai)\b|do not|வேண்டாம்|வேணாம்|இல்லை/.test(rest))return;
 // Match the whole suffix: an acknowledgement must not hide a second edit.
 // The second form is the non-shopping background phrase in the saved clip.
 if(rest&&!/^(?:(?:please|thanks|okay|ok|yes|ஆமா|ஆமாம்|சரி|aama|sari)(?:\s+(?:please|thanks|okay|ok|yes|ஆமா|ஆமாம்|சரி|aama|sari))*|(?:ஆமா|ஆமாம்|சரி) என்ன வேலையில(?: வேலை)?)$/.test(rest))return;
 return 'clear my list';
}
export function negatedSpokenClear(text:string):boolean {
 const clean=speechText(text);
 if(tamilClear.test(clean))return clearNegation.test(clean)||quotedOrQuestion.test(text.toLowerCase());
 return /^(?:(?:don't|dont|do not)\s+)?(?:clear (?:my|the) list|empty my list|(?:பட்டியலை(?:க்|ய)?|பட்டியல்(?: எல்லாம்)?) காலி செய்|list clear pannu)(?:\s|$)/.test(clean)&&clearNegation.test(clean);
}
export function quantityReply(text:string):{quantity:number;unit?:string}|undefined {
  const m=/^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|half|ஒன்று|ஒரு|ஒன்னு|இரண்டு|ரெண்டு|மூன்று|நான்கு|நாலு|ஐந்து|அஞ்சு|ஆறு|ஏழு|எட்டு|ஒன்பது|பத்து|அரை|onnu|oru|ondru|rendu|irandu|moonu|moondru|naalu|naangu|anju|ainthu|aaru|ezhu|ettu|onbathu|paththu|pathu|arai)(?:\s+(pieces?|pcs|box(?:es)?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?|bottles?|cans?|tins?|buckets?|கேன்|வாளி|litres?|liters?|units?|nos|எண்ணம்|பீஸ்|பெட்டி|பெட்டிகள்|பாக்ஸ்|பாட்டில்|பாட்டில்கள்|ரோல்|ரோல்கள்|அடி|மீட்டர்|கிலோ|ஜோடி|பேக்|லிட்டர்|ennam|petti|pettigal|adi|jodi|kilo))?(?:\s+(?:please|வேண்டும்|வேணும்|venum))?[.!?]*$/i.exec(text.trim());
  return m?{quantity:numbers[m[1].toLowerCase()]??Number(m[1]),...(m[2]?{unit:m[2].toLowerCase()}:{})}:undefined;
}
export function priceInquiry(text:string):{query:string;quantity?:number;requestedUnit?:string}|undefined {
  const s=text.toLowerCase().trim().replace(/[.!?]+$/,'');
  if(/வேண்டும்|வேணும்|சேர்|நீக்கு|மாற்று|\b(?:venum|seru|neekku|maathu)\b/.test(s))return;
  const native=/^(.+?)\s+(?:விலை(?: என்ன| எவ்வளவு)?|என்ன விலை|எவ்வளவு|vilai(?: enna)?|evlo|price enna)$/.exec(s);
  if(native)return {query:native[1]};
  if(/\b(?:add|remove|change|set|place order|i need|i want|i will take|i'll take)\b/.test(s)||/delivery|shipping|discount|trade (?:price|rate)|plumber rate|best price/.test(s))return;
  const lead=/^(?:(?:what is the |what's the |what is |what's )?(?:price|cost)(?: of| for)?\s+|how much (?:is |are |for |does )?)/.exec(s);
  if(!lead)return;
  let query=s.slice(lead[0].length).trim();if(!query)return;
  let quantity:number|undefined,requestedUnit:string|undefined;
  const amount=/^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|half|ஒன்று|ஒரு|ஒன்னு|இரண்டு|ரெண்டு|மூன்று|நான்கு|நாலு|ஐந்து|அஞ்சு|ஆறு|ஏழு|எட்டு|ஒன்பது|பத்து|அரை|onnu|oru|ondru|rendu|irandu|moonu|moondru|naalu|naangu|anju|ainthu|aaru|ezhu|ettu|onbathu|paththu|pathu|arai)\s+(.+)$/.exec(query);
  // A leading size such as 1 inch/25 mm is part of the specification.
  if(amount&&!/^(?:inch(?:es)?|in\b|mm\b|cm\b)/.test(amount[2])) {quantity=numbers[amount[1]]??Number(amount[1]);query=amount[2];}
  const unit=/^(pieces?|pcs|box(?:es)?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?)\s+(?:of\s+)?(.+)$/.exec(query);
  if(unit){requestedUnit=unit[1];query=unit[2]+(/^box/.test(unit[1])?' box':'');}
  else {const tail=/\s+(pieces?|pcs|box(?:es)?|rolls?|feet|ft|metres?|meters?|kg|packs?|pairs?)$/.exec(query);if(tail){requestedUnit=tail[1];if(!/^box/.test(tail[1]))query=query.slice(0,-tail[0].length);}}
  return {query,...(quantity!==undefined?{quantity}:{}),...(requestedUnit?{requestedUnit}:{})};
}
